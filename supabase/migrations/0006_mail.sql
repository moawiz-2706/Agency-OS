-- AgencyOS 0006 — Gmail: each team member connects their own inbox, emails are
-- scheduled and sent from the CRM, and sends, replies and bounces sync back.
-- Additive and safe to re-run. Supabase -> SQL Editor -> New query -> paste -> Run.
--
-- Security model
-- * Refresh tokens are AES-256-GCM encrypted by the web server before they reach the
--   database (key only in Vercel env). Nobody can read mail_accounts directly.
-- * Team members never write mail tables directly: they call the functions below,
--   which check who they are. A message is always sent from its author's own inbox.
-- * The background worker (Vercel route, run every 5 min by pg_cron) has no
--   service-role key. It calls mailer_* functions with a secret whose SHA-256 hash is
--   stored here; those functions touch mail data only.
-- * Every send re-checks suppression, do-not-contact, bounces and consent
--   (outreach_block_reason + the 0002 send guard), the kill switch, a daily limit per
--   inbox and a 2-minute gap between sends.
--
-- After running it, set the worker secret once (same value as MAILER_SECRET on Vercel):
--   select mailer_set_secret('<MAILER_SECRET>');

-- ---------- mail accounts: one inbox per team member ----------
alter table mail_accounts add column if not exists member_id       uuid references team_members(id) on delete cascade;
alter table mail_accounts add column if not exists signature       text;          -- name, agency, phone, postal address
alter table mail_accounts add column if not exists connected_at    timestamptz;
alter table mail_accounts add column if not exists synced_until    timestamptz;   -- sync cursor: Gmail messages after this
alter table mail_accounts add column if not exists last_sync_at    timestamptz;
alter table mail_accounts add column if not exists last_sent_at    timestamptz;
alter table mail_accounts add column if not exists last_error      text;
alter table mail_accounts add column if not exists needs_reconnect boolean not null default false;
create unique index if not exists mail_accounts_member_uq on mail_accounts (member_id);

-- ---------- outreach messages: who sends, where it came from ----------
alter table outreach_messages add column if not exists member_id uuid references team_members(id) on delete set null;
alter table outreach_messages add column if not exists source text not null default 'crm';
do $$ begin
  alter table outreach_messages add constraint outreach_messages_source_chk check (source in ('crm','gmail','import'));
exception when duplicate_object then null; end $$;
alter table outreach_messages alter column idempotency_key set default gen_random_uuid()::text;
create unique index if not exists outreach_messages_gmail_uq on outreach_messages (gmail_message_id) where gmail_message_id is not null;
create index if not exists outreach_messages_contact_idx on outreach_messages (contact_id, step);
create index if not exists outreach_messages_company_idx on outreach_messages (company_id, created_at desc);
create index if not exists outreach_messages_thread_idx  on outreach_messages (thread_id);

alter table inbound_messages add column if not exists mail_account_id uuid references mail_accounts(id) on delete set null;
alter table inbound_messages add column if not exists rfc_message_id  text;
create index if not exists inbound_messages_company_idx on inbound_messages (company_id, received_at desc);
create index if not exists inbound_messages_thread_idx  on inbound_messages (thread_id);

-- ---------- worker secret ----------
create table if not exists mailer_config (
  id          int primary key default 1 check (id = 1),
  secret_hash bytea not null,
  updated_at  timestamptz not null default now()
);
alter table mailer_config enable row level security;   -- no policies: unreadable through the API
revoke all on mailer_config from anon, authenticated;

create or replace function mailer_set_secret(secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if secret is null or length(secret) < 32 then raise exception 'use a secret of at least 32 characters'; end if;
  insert into mailer_config (id, secret_hash) values (1, sha256(convert_to(secret, 'UTF8')))
  on conflict (id) do update set secret_hash = excluded.secret_hash, updated_at = now();
end $$;

create or replace function mailer_check(secret text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if secret is null or length(secret) < 32
     or not exists (select 1 from mailer_config where secret_hash = sha256(convert_to(secret, 'UTF8'))) then
    raise exception 'mailer: not authorised' using errcode = '42501';
  end if;
end $$;

-- ---------- can this contact be emailed? (null = yes) ----------
create or replace function outreach_block_reason(p_contact uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c  contacts%rowtype;
  co companies%rowtype;
begin
  select * into c from contacts where id = p_contact;
  if not found or c.email is null then return 'the contact has no email'; end if;
  if c.do_not_contact then return 'the contact is marked do-not-contact'; end if;
  if c.email_status in ('bounced', 'invalid') then return 'the email bounced or is invalid'; end if;
  if exists (select 1 from suppressions s
             where lower(s.email) = lower(c.email) or lower(s.domain) = lower(split_part(c.email, '@', 2))) then
    return 'the email is on the never-contact list';
  end if;
  if c.consent_basis = 'unknown' then return 'no consent basis is recorded'; end if;
  select * into co from companies where id = c.company_id;
  if co.country = 'CA' and c.consent_basis not in ('casl_implied_published', 'casl_implied_relationship', 'express') then
    return 'Canadian contact without a CASL basis';
  end if;
  if co.stage in ('won', 'lost', 'disqualified') then return 'the lead is closed'; end if;
  return null;
end $$;

-- Record a Gmail thread against a lead (insert, or bump its last message time).
create or replace function mail_touch_thread(p_thread text, p_account uuid, p_company uuid, p_contact uuid,
                                             p_subject text, p_at timestamptz, p_unread boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if p_thread is null then return null; end if;
  insert into email_threads (thread_id, mail_account_id, company_id, contact_id, subject, last_message_at, unread, handled)
  values (p_thread, p_account, p_company, p_contact, p_subject, p_at, p_unread, not p_unread)
  on conflict (thread_id) do update set
    last_message_at = greatest(email_threads.last_message_at, excluded.last_message_at),
    unread  = email_threads.unread or excluded.unread,
    handled = case when excluded.unread then false else email_threads.handled end
  returning id into tid;
  return tid;
end $$;

-- Stop everything still waiting to go to a lead (they replied) or a contact (bounced, opted out).
create or replace function mail_stop_pending(p_company uuid, p_contact uuid, p_before timestamptz, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update outreach_messages set status = 'cancelled', error = p_reason
  where status in ('draft', 'pending_approval', 'approved', 'failed')
    and (p_company is null or company_id = p_company)
    and (p_contact is null or contact_id = p_contact)
    and created_at < p_before;
  get diagnostics n = row_count;
  return n;
end $$;

-- =====================================================================
-- Team members (signed in): their own inbox and their own messages
-- =====================================================================

create or replace function my_mail_account() returns table (
  email text, from_name text, signature text, daily_limit int, connected boolean, needs_reconnect boolean,
  last_error text, last_sync_at timestamptz, last_sent_at timestamptz, sent_24h int, sending_enabled boolean)
language sql stable security definer set search_path = public as $$
  select a.email, a.from_name, a.signature, a.daily_limit,
         a.refresh_token_encrypted is not null and a.active, a.needs_reconnect, a.last_error, a.last_sync_at, a.last_sent_at,
         (select count(*)::int from outreach_messages o where o.mail_account_id = a.id and o.status = 'sent' and o.sent_at > now() - interval '24 hours'),
         coalesce((select value = 'true'::jsonb from settings where key = 'sending_enabled'), false)
  from mail_accounts a
  where a.member_id = current_member_id()
$$;

create or replace function sending_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from settings where key = 'sending_enabled'), false)
$$;

-- Called by the OAuth callback with the already-encrypted refresh token.
create or replace function save_my_mail_account(p_email text, p_from_name text, p_token_encrypted text) returns void
language plpgsql security definer set search_path = public as $$
declare m uuid := current_member_id();
begin
  if m is null then raise exception 'not on the team' using errcode = '42501'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or coalesce(p_token_encrypted, '') !~ '^v1\.' then raise exception 'bad mail account'; end if;
  if exists (select 1 from mail_accounts where lower(email) = lower(p_email) and member_id is distinct from m) then
    raise exception '% is already connected by another team member', p_email;
  end if;
  insert into mail_accounts (member_id, email, from_name, refresh_token_encrypted, connected_at, active, needs_reconnect, last_error, synced_until)
  values (m, lower(p_email), nullif(trim(p_from_name), ''), p_token_encrypted, now(), true, false, null, now() - interval '14 days')
  on conflict (member_id) do update set
    email = excluded.email,
    from_name = coalesce(mail_accounts.from_name, excluded.from_name),
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    connected_at = now(), active = true, needs_reconnect = false, last_error = null,
    -- a different inbox starts its own look-back; reconnecting the same one keeps its cursor
    synced_until = case when mail_accounts.email = excluded.email then mail_accounts.synced_until else excluded.synced_until end;
end $$;

create or replace function save_my_mail_settings(p_from_name text, p_signature text, p_daily_limit int) returns void
language plpgsql security definer set search_path = public as $$
declare m uuid := current_member_id();
begin
  if m is null then raise exception 'not on the team' using errcode = '42501'; end if;
  if length(coalesce(trim(p_signature), '')) < 20 then
    raise exception 'the signature needs your name and postal address (the law requires the address in every email)';
  end if;
  update mail_accounts set from_name = nullif(trim(p_from_name), ''), signature = trim(p_signature),
                           daily_limit = greatest(1, least(40, coalesce(p_daily_limit, 20)))
  where member_id = m;
  if not found then raise exception 'connect your Gmail first'; end if;
end $$;

create or replace function disconnect_my_mail_account() returns void
language sql security definer set search_path = public as $$
  update mail_accounts set refresh_token_encrypted = null, active = false where member_id = current_member_id()
$$;

-- Owner-only kill switch for all sending.
create or replace function set_sending_enabled(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_owner() then raise exception 'only an owner can turn sending on or off' using errcode = '42501'; end if;
  insert into settings (key, value) values ('sending_enabled', to_jsonb(coalesce(p_on, false)))
  on conflict (key) do update set value = excluded.value;
end $$;

-- Write an email to a lead. It goes out from YOUR inbox at p_scheduled_for (now if null)
-- once approved. Follow-ups to the same contact are sent as replies in the same thread.
create or replace function queue_email(p_company uuid, p_contact uuid, p_subject text, p_body text,
                                       p_scheduled_for timestamptz default null, p_approve boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m uuid := current_member_id();
  reason text;
  nstep int;
  new_id uuid;
begin
  if m is null then raise exception 'not on the team' using errcode = '42501'; end if;
  if not exists (select 1 from contacts where id = p_contact and company_id = p_company) then
    raise exception 'that contact is not on this lead';
  end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_body), '') = '' then raise exception 'write a subject and a message'; end if;
  reason := outreach_block_reason(p_contact);
  if reason is not null then raise exception 'can''t email this contact: %', reason; end if;
  select coalesce(max(step), 0) + 1 into nstep from outreach_messages where contact_id = p_contact and status <> 'cancelled';
  insert into outreach_messages (company_id, contact_id, member_id, step, subject, body, status, scheduled_for,
                                 approved_by, approved_at, source)
  values (p_company, p_contact, m, nstep, trim(p_subject), trim(p_body),
          case when p_approve then 'approved' else 'pending_approval' end, coalesce(p_scheduled_for, now()),
          case when p_approve then m::text end, case when p_approve then now() end, 'crm')
  returning id into new_id;
  return new_id;
end $$;

-- Approve (schedule) one of your own emails; p_now sends it at the next run.
create or replace function approve_email(p_id uuid, p_now boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  m uuid := current_member_id();
  msg outreach_messages%rowtype;
  reason text;
begin
  select * into msg from outreach_messages where id = p_id for update;
  if not found then raise exception 'email not found'; end if;
  if m is null or msg.member_id is distinct from m then raise exception 'only its author can approve an email (it goes out from their inbox)' using errcode = '42501'; end if;
  if msg.status not in ('draft', 'pending_approval', 'failed') then raise exception 'this email is already %', msg.status; end if;
  reason := outreach_block_reason(msg.contact_id);
  if reason is not null then raise exception 'can''t email this contact: %', reason; end if;
  update outreach_messages set status = 'approved', approved_by = m::text, approved_at = now(), error = null,
         scheduled_for = case when p_now or scheduled_for is null then now() else scheduled_for end
  where id = p_id;
end $$;

create or replace function update_email(p_id uuid, p_subject text, p_body text, p_scheduled_for timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  m uuid := current_member_id();
  msg outreach_messages%rowtype;
begin
  select * into msg from outreach_messages where id = p_id for update;
  if not found then raise exception 'email not found'; end if;
  if m is null or msg.member_id is distinct from m then raise exception 'only its author can edit an email' using errcode = '42501'; end if;
  if msg.status not in ('draft', 'pending_approval', 'approved', 'failed') then raise exception 'this email is already %', msg.status; end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_body), '') = '' then raise exception 'write a subject and a message'; end if;
  update outreach_messages set subject = trim(p_subject), body = trim(p_body),
         scheduled_for = coalesce(p_scheduled_for, scheduled_for),
         status = case when status = 'failed' then 'pending_approval' else status end, error = null
  where id = p_id;
end $$;

create or replace function cancel_email(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_member() then raise exception 'not on the team' using errcode = '42501'; end if;
  update outreach_messages set status = 'cancelled', error = 'cancelled by ' || coalesce((select full_name from team_members where id = current_member_id()), 'a team member')
  where id = p_id and status in ('draft', 'pending_approval', 'approved', 'failed');
  if not found then raise exception 'this email can''t be cancelled any more'; end if;
end $$;

create or replace function mark_reply_handled(p_id uuid, p_handled boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not is_team_member() then raise exception 'not on the team' using errcode = '42501'; end if;
  update inbound_messages set handled = p_handled where id = p_id returning email_thread_id into t;
  if t is not null then update email_threads set handled = p_handled, unread = not p_handled where id = t; end if;
end $$;

-- =====================================================================
-- Worker (Vercel route, no user session): every call needs the mailer secret
-- =====================================================================

create or replace function mailer_accounts(secret text, p_member uuid default null) returns table (
  id uuid, member_id uuid, email text, from_name text, token text, synced_until timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  return query
    select a.id, a.member_id, a.email, a.from_name, a.refresh_token_encrypted, a.synced_until
    from mail_accounts a
    where a.active and a.refresh_token_encrypted is not null and not a.needs_reconnect
      and (p_member is null or a.member_id = p_member)
    order by a.created_at;
end $$;

create or replace function mailer_account_error(secret text, p_account uuid, p_error text, p_needs_reconnect boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  update mail_accounts set last_error = left(p_error, 500), needs_reconnect = needs_reconnect or coalesce(p_needs_reconnect, false)
  where id = p_account;
end $$;

-- Which of these Gmail messages (id, thread_id, from, to[]) involve our leads and aren't stored yet?
create or replace function mailer_match(secret text, p_account uuid, p_msgs jsonb) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare ids text[];
begin
  perform mailer_check(secret);
  select coalesce(array_agg(e->>'id'), '{}') into ids
  from jsonb_array_elements(p_msgs) e
  where not exists (select 1 from outreach_messages o where o.gmail_message_id = e->>'id')
    and not exists (select 1 from inbound_messages i where i.gmail_message_id = e->>'id')
    and (
      exists (select 1 from contacts c
              where c.email is not null
                and (lower(c.email) = lower(e->>'from')
                     or lower(c.email) in (select lower(x) from jsonb_array_elements_text(coalesce(e->'to', '[]'::jsonb)) x)))
      or exists (select 1 from outreach_messages o where o.thread_id = e->>'thread_id' and o.mail_account_id = p_account)
    );
  return ids;
end $$;

-- Save synced Gmail messages, oldest first. kind: sent (you sent it in Gmail), reply,
-- auto_reply (out of office), bounce. unsubscribe: the reply asks to stop.
create or replace function mailer_sync_save(secret text, p_account uuid, p_msgs jsonb, p_synced_until timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a     mail_accounts%rowtype;
  e     jsonb;
  ct    contacts%rowtype;
  kind  text;
  gid   text;
  thr   text;
  msg_at timestamptz;
  nstep int;
  tid   uuid;
  cls   text;
  res   jsonb := jsonb_build_object('sent', 0, 'replies', 0, 'bounces', 0, 'auto_replies', 0, 'unsubscribes', 0, 'skipped', 0);
begin
  perform mailer_check(secret);
  select * into a from mail_accounts where id = p_account;
  if not found then raise exception 'unknown mail account'; end if;

  for e in select x from jsonb_array_elements(p_msgs) x order by (x->>'date')::timestamptz nulls first loop
    begin
      kind := e->>'kind';
      gid  := e->>'id';
      thr  := e->>'thread_id';
      msg_at := coalesce((e->>'date')::timestamptz, now());
      if gid is null
         or exists (select 1 from outreach_messages where gmail_message_id = gid)
         or exists (select 1 from inbound_messages where gmail_message_id = gid) then
        continue;
      end if;

      if kind = 'sent' then
        -- An email you sent from Gmail itself (not through the CRM): record it as sent.
        select c.* into ct from contacts c
        where c.email is not null
          and lower(c.email) in (select lower(x) from jsonb_array_elements_text(coalesce(e->'to', '[]'::jsonb)) x)
        order by c.created_at limit 1;
        if ct.id is null or outreach_block_reason(ct.id) is not null then
          res := jsonb_set(res, '{skipped}', to_jsonb((res->>'skipped')::int + 1));
          continue;
        end if;
        select coalesce(max(step), 0) + 1 into nstep from outreach_messages where contact_id = ct.id and status = 'sent';
        insert into outreach_messages (company_id, contact_id, member_id, mail_account_id, step, status, subject, body,
                                       scheduled_for, sent_at, gmail_message_id, thread_id, rfc_message_id, in_reply_to,
                                       source, idempotency_key)
        values (ct.company_id, ct.id, a.member_id, a.id, nstep, 'sent', coalesce(nullif(e->>'subject', ''), '(no subject)'),
                coalesce(e->>'body', ''), msg_at, msg_at, gid, thr, e->>'rfc_id', e->>'in_reply_to', 'gmail', 'gmail:' || gid);
        insert into touches (company_id, contact_id, member_id, channel, direction, outcome, minutes, summary, happened_at)
        values (ct.company_id, ct.id, a.member_id, 'email', 'outbound', 'sent', 0,
                'Email ' || nstep || ' (sent from Gmail): ' || coalesce(e->>'subject', ''), msg_at);
        perform mail_touch_thread(thr, a.id, ct.company_id, ct.id, e->>'subject', msg_at, false);
        res := jsonb_set(res, '{sent}', to_jsonb((res->>'sent')::int + 1));

      elsif kind = 'bounce' then
        -- The bounce lands in the thread of the email that failed.
        select c.* into ct from outreach_messages o join contacts c on c.id = o.contact_id
        where o.thread_id = thr and o.mail_account_id = a.id and o.status = 'sent'
        order by o.sent_at desc limit 1;
        if ct.id is null and e->>'bounced_to' is not null then
          select c.* into ct from contacts c where lower(c.email) = lower(e->>'bounced_to') order by c.created_at limit 1;
        end if;
        if ct.id is null then
          res := jsonb_set(res, '{skipped}', to_jsonb((res->>'skipped')::int + 1));
          continue;
        end if;
        update contacts set email_status = 'bounced' where id = ct.id;
        perform mail_stop_pending(null, ct.id, now(), 'stopped: the email bounced');
        insert into inbound_messages (gmail_message_id, thread_id, company_id, contact_id, mail_account_id, rfc_message_id,
                                      from_email, subject, snippet, body_text, received_at, classification, classified_by, handled)
        values (gid, thr, ct.company_id, ct.id, a.id, e->>'rfc_id', coalesce(e->>'from', 'mailer-daemon'), e->>'subject',
                left(e->>'snippet', 300), left(e->>'body', 20000), msg_at, 'bounce', 'system', true);
        insert into activities (company_id, type, payload, actor)
        values (ct.company_id, 'email_bounced', jsonb_build_object('email', ct.email, 'gmail_message_id', gid), 'system');
        res := jsonb_set(res, '{bounces}', to_jsonb((res->>'bounces')::int + 1));

      else
        -- A reply (or auto-reply) from a lead: by sender, else by the thread we started.
        select c.* into ct from contacts c
        where c.email is not null and lower(c.email) = lower(e->>'from')
        order by exists (select 1 from outreach_messages o where o.contact_id = c.id and o.thread_id = thr) desc, c.created_at
        limit 1;
        if ct.id is null then
          select c.* into ct from outreach_messages o join contacts c on c.id = o.contact_id
          where o.thread_id = thr and o.mail_account_id = a.id
          order by o.sent_at desc nulls last limit 1;
        end if;
        if ct.id is null then
          res := jsonb_set(res, '{skipped}', to_jsonb((res->>'skipped')::int + 1));
          continue;
        end if;

        cls := case when kind = 'auto_reply' then 'out_of_office'
                    when coalesce((e->>'unsubscribe')::boolean, false) then 'unsubscribe' end;
        tid := mail_touch_thread(thr, a.id, ct.company_id, ct.id, e->>'subject', msg_at, kind <> 'auto_reply');
        insert into inbound_messages (gmail_message_id, thread_id, email_thread_id, company_id, contact_id, mail_account_id,
                                      rfc_message_id, from_email, subject, snippet, body_text, received_at,
                                      classification, classified_by, handled)
        values (gid, thr, tid, ct.company_id, ct.id, a.id, e->>'rfc_id', lower(e->>'from'), e->>'subject',
                left(e->>'snippet', 300), left(e->>'body', 20000), msg_at, cls, case when cls is not null then 'system' end,
                kind = 'auto_reply');

        if kind = 'auto_reply' then
          res := jsonb_set(res, '{auto_replies}', to_jsonb((res->>'auto_replies')::int + 1));
          continue;   -- out of office: not a real reply, the sequence keeps going
        end if;

        insert into touches (company_id, contact_id, member_id, channel, direction, outcome, minutes, summary, happened_at)
        values (ct.company_id, ct.id, a.member_id, 'email', 'inbound', 'replied', 0,
                'Reply: ' || coalesce(nullif(e->>'snippet', ''), e->>'subject', ''), msg_at);
        perform mail_stop_pending(ct.company_id, null, msg_at, 'stopped: they replied');
        res := jsonb_set(res, '{replies}', to_jsonb((res->>'replies')::int + 1));

        if cls = 'unsubscribe' then
          update contacts set do_not_contact = true where id = ct.id;
          insert into suppressions (email, reason, contact_id) values (lower(ct.email), 'asked_not_to', ct.id) on conflict do nothing;
          insert into activities (company_id, type, payload, actor)
          values (ct.company_id, 'unsubscribed', jsonb_build_object('email', ct.email, 'gmail_message_id', gid), 'system');
          res := jsonb_set(res, '{unsubscribes}', to_jsonb((res->>'unsubscribes')::int + 1));
        end if;
      end if;
    exception when others then
      -- One bad message never blocks the rest of the sync.
      res := jsonb_set(res, '{skipped}', to_jsonb((res->>'skipped')::int + 1));
    end;
  end loop;

  update mail_accounts set
    synced_until = greatest(coalesce(synced_until, p_synced_until), p_synced_until),
    last_sync_at = now(), last_error = null
  where id = a.id;
  return res;
end $$;

-- Take the next due, approved email for this inbox (at most one per run), or null.
-- Returns everything needed to send it, including the thread to reply in.
create or replace function mailer_claim(secret text, p_account uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a      mail_accounts%rowtype;
  msg    outreach_messages%rowtype;
  ct     contacts%rowtype;
  reason text;
  thr    text;
  first_subject text;
  refs   text[];
begin
  perform mailer_check(secret);

  -- A send that never reported back: don't retry blindly (it may have gone out).
  update outreach_messages set status = 'failed', error = 'no confirmation from Gmail: check your Sent folder before retrying'
  where status = 'queued' and updated_at < now() - interval '15 minutes';

  if not sending_enabled() then return null; end if;
  select * into a from mail_accounts
  where id = p_account and active and refresh_token_encrypted is not null and not needs_reconnect
  for update;
  if not found or coalesce(trim(a.signature), '') = '' then return null; end if;
  if a.last_sent_at > now() - interval '2 minutes' then return null; end if;
  if (select count(*) from outreach_messages
      where mail_account_id = a.id and status in ('sent', 'queued') and coalesce(sent_at, updated_at) > now() - interval '24 hours') >= a.daily_limit then
    return null;
  end if;

  loop
    select * into msg from outreach_messages
    where status = 'approved' and member_id = a.member_id and scheduled_for <= now()
    order by scheduled_for, created_at
    limit 1 for update skip locked;
    exit when not found;

    reason := outreach_block_reason(msg.contact_id);
    if reason is not null then
      update outreach_messages set status = 'cancelled', error = 'blocked: ' || reason where id = msg.id;
      continue;
    end if;
    select * into ct from contacts where id = msg.contact_id;

    -- Follow-ups go in the latest thread this inbox has with the contact.
    select o.thread_id into thr from outreach_messages o
    where o.contact_id = ct.id and o.mail_account_id = a.id and o.status = 'sent' and o.thread_id is not null
    order by o.sent_at desc limit 1;
    if thr is not null then
      select o.subject into first_subject from outreach_messages o
      where o.thread_id = thr and o.status = 'sent' order by o.sent_at limit 1;
      select array_agg(r order by t) into refs from (
        select o.rfc_message_id r, o.sent_at t from outreach_messages o where o.thread_id = thr and o.rfc_message_id is not null and o.status = 'sent'
        union all
        select i.rfc_message_id, i.received_at from inbound_messages i where i.thread_id = thr and i.rfc_message_id is not null
      ) q;
    elsif msg.subject ~* '^\s*re\s*:' then
      -- A follow-up whose first email isn't known yet: never send a "Re:" that isn't a reply.
      update outreach_messages set status = 'failed',
             error = 'this is a follow-up, but the first email to this contact isn''t synced from your Gmail yet: sync, then approve it again'
      where id = msg.id;
      continue;
    end if;

    update outreach_messages set status = 'queued', mail_account_id = a.id, thread_id = thr,
           in_reply_to = refs[array_upper(refs, 1)], error = null
    where id = msg.id;

    return jsonb_build_object(
      'id', msg.id, 'step', msg.step,
      'to', ct.email, 'to_name', ct.full_name,
      'subject', case when thr is null then msg.subject
                      else 'Re: ' || regexp_replace(coalesce(first_subject, msg.subject), '^\s*((re|fwd?)\s*:\s*)+', '', 'i') end,
      'body', msg.body,
      'thread_id', thr,
      'in_reply_to', refs[array_upper(refs, 1)],
      'references', array_to_string(refs[greatest(1, coalesce(array_upper(refs, 1), 0) - 9):], ' '),
      'from_email', a.email, 'from_name', a.from_name, 'signature', a.signature);
  end loop;
  return null;
end $$;

create or replace function mailer_result(secret text, p_message uuid, p_ok boolean, p_gmail_id text,
                                         p_thread_id text, p_rfc_id text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare msg outreach_messages%rowtype;
begin
  perform mailer_check(secret);
  select * into msg from outreach_messages where id = p_message and status = 'queued' for update;
  if not found then return; end if;
  if not p_ok then
    update outreach_messages set status = 'failed', error = left(coalesce(p_error, 'send failed'), 500) where id = msg.id;
    return;
  end if;
  update outreach_messages set status = 'sent', sent_at = now(), gmail_message_id = p_gmail_id,
         thread_id = coalesce(p_thread_id, thread_id), rfc_message_id = p_rfc_id, error = null
  where id = msg.id;
  update mail_accounts set last_sent_at = now() where id = msg.mail_account_id;
  insert into touches (company_id, contact_id, member_id, channel, direction, outcome, minutes, summary, happened_at)
  values (msg.company_id, msg.contact_id, msg.member_id, 'email', 'outbound', 'sent', 0,
          'Email ' || msg.step || ': ' || msg.subject, now());
  perform mail_touch_thread(coalesce(p_thread_id, msg.thread_id), msg.mail_account_id, msg.company_id, msg.contact_id,
                            msg.subject, now(), false);
end $$;

-- ---------- what the web app can read ----------
do $$
declare t text;
begin
  foreach t in array array['outreach_messages', 'email_threads', 'inbound_messages'] loop
    execute format('drop policy if exists team_select on %I', t);
    execute format('create policy team_select on %I for select to authenticated using (is_team_member())', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;
revoke all on mail_accounts from anon, authenticated;

-- ---------- who may call what ----------
-- Supabase grants EXECUTE on new functions to everyone by default; take it back first.
do $$
declare f text;
begin
  foreach f in array array[
    'mailer_set_secret(text)', 'mailer_check(text)', 'outreach_block_reason(uuid)',
    'mail_touch_thread(text,uuid,uuid,uuid,text,timestamptz,boolean)', 'mail_stop_pending(uuid,uuid,timestamptz,text)',
    'my_mail_account()', 'sending_enabled()', 'save_my_mail_account(text,text,text)', 'save_my_mail_settings(text,text,int)',
    'disconnect_my_mail_account()', 'set_sending_enabled(boolean)',
    'queue_email(uuid,uuid,text,text,timestamptz,boolean)', 'approve_email(uuid,boolean)',
    'update_email(uuid,text,text,timestamptz)', 'cancel_email(uuid)', 'mark_reply_handled(uuid,boolean)',
    'mailer_accounts(text,uuid)', 'mailer_account_error(text,uuid,text,boolean)', 'mailer_match(text,uuid,jsonb)',
    'mailer_sync_save(text,uuid,jsonb,timestamptz)', 'mailer_claim(text,uuid)',
    'mailer_result(text,uuid,boolean,text,text,text,text)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;

  -- signed-in team members (each function checks who is calling)
  foreach f in array array[
    'my_mail_account()', 'sending_enabled()', 'save_my_mail_account(text,text,text)', 'save_my_mail_settings(text,text,int)',
    'disconnect_my_mail_account()', 'set_sending_enabled(boolean)',
    'queue_email(uuid,uuid,text,text,timestamptz,boolean)', 'approve_email(uuid,boolean)',
    'update_email(uuid,text,text,timestamptz)', 'cancel_email(uuid)', 'mark_reply_handled(uuid,boolean)']
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- the worker (anon key + mailer secret)
  foreach f in array array[
    'mailer_accounts(text,uuid)', 'mailer_account_error(text,uuid,text,boolean)', 'mailer_match(text,uuid,jsonb)',
    'mailer_sync_save(text,uuid,jsonb,timestamptz)', 'mailer_claim(text,uuid)',
    'mailer_result(text,uuid,boolean,text,text,text,text)']
  loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
