-- AgencyOS 0007 — GoDaddy (any IMAP/SMTP) inboxes, and several inboxes per person.
-- Run after 0006. Safe to re-run; from now on re-run this file, not 0006 (0006 would put
-- back the one-inbox-per-person functions). Supabase -> SQL Editor -> paste -> Run.
--
-- * A team member can connect several inboxes (personal Gmail, moawiz@yourdomain...) and
--   picks one as default. Each email can name the inbox it goes from; if it doesn't, a
--   follow-up goes from the inbox that last emailed that contact (so it stays in the same
--   thread), anything else from the default inbox.
-- * IMAP/SMTP inboxes (GoDaddy Professional Email etc.) store the mailbox password in the
--   same column as Gmail tokens, encrypted the same way (AES-256-GCM on the server, key
--   only in Vercel, bound to the address). It can't be read through the API.

-- ---------- mail accounts: provider settings, several per member ----------
do $$ begin
  alter table mail_accounts drop constraint if exists mail_accounts_provider_check;
  alter table mail_accounts add constraint mail_accounts_provider_check check (provider in ('gmail', 'microsoft', 'imap'));
end $$;
alter table mail_accounts add column if not exists imap_host   text;
alter table mail_accounts add column if not exists imap_port   int;
alter table mail_accounts add column if not exists smtp_host   text;
alter table mail_accounts add column if not exists smtp_port   int;
alter table mail_accounts add column if not exists is_default  boolean not null default false;
comment on column mail_accounts.refresh_token_encrypted is
  'Gmail refresh token, or the IMAP/SMTP mailbox password. Always AES-256-GCM encrypted by the web server (MAIL_TOKEN_KEY).';

drop index if exists mail_accounts_member_uq;
create index if not exists mail_accounts_member_idx on mail_accounts (member_id);
-- Inboxes connected before this migration become their owner's default.
update mail_accounts a set is_default = true
where member_id is not null and not exists (select 1 from mail_accounts b where b.member_id = a.member_id and b.is_default);
create unique index if not exists mail_accounts_one_default_uq on mail_accounts (member_id) where is_default;

-- The functions whose signature or result changes.
drop function if exists my_mail_account();
drop function if exists save_my_mail_settings(text, text, int);
drop function if exists disconnect_my_mail_account();
drop function if exists queue_email(uuid, uuid, text, text, timestamptz, boolean);
drop function if exists mailer_accounts(text, uuid);

-- Which of a member's inboxes should email this contact: the one that last did (to stay
-- in its thread), else their default. Only connected inboxes count.
create or replace function mail_pick_account(p_member uuid, p_contact uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.mail_account_id from outreach_messages o join mail_accounts x on x.id = o.mail_account_id
     where o.contact_id = p_contact and o.status = 'sent' and x.member_id = p_member
       and x.active and x.refresh_token_encrypted is not null
     order by o.sent_at desc limit 1),
    (select x.id from mail_accounts x
     where x.member_id = p_member and x.active and x.refresh_token_encrypted is not null
     order by x.is_default desc, x.created_at limit 1))
$$;

-- Make `p_account` the member's default (or, with null, the oldest connected inbox).
create or replace function mail_fix_default(p_member uuid, p_account uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update mail_accounts set is_default = false where member_id = p_member and is_default and id is distinct from p_account;
  update mail_accounts set is_default = true
  where id = coalesce(p_account, (select id from mail_accounts where member_id = p_member and active and refresh_token_encrypted is not null
                                  order by created_at limit 1));
end $$;

-- =====================================================================
-- Team members (signed in)
-- =====================================================================

create or replace function my_mail_accounts() returns table (
  id uuid, email text, provider text, from_name text, signature text, daily_limit int, is_default boolean,
  connected boolean, needs_reconnect boolean, last_error text, last_sync_at timestamptz, last_sent_at timestamptz,
  sent_24h int, sending_enabled boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.email, a.provider, a.from_name, a.signature, a.daily_limit, a.is_default,
         a.refresh_token_encrypted is not null and a.active, a.needs_reconnect, a.last_error, a.last_sync_at, a.last_sent_at,
         (select count(*)::int from outreach_messages o where o.mail_account_id = a.id and o.status = 'sent' and o.sent_at > now() - interval '24 hours'),
         sending_enabled()
  from mail_accounts a
  where a.member_id = current_member_id() and (a.active or a.needs_reconnect)
  order by a.is_default desc, a.created_at
$$;

-- Every connected inbox on the team (address only), to show which inbox an email went from.
create or replace function team_inboxes() returns table (id uuid, email text, member_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.email, a.member_id from mail_accounts a where is_team_member()
$$;

create or replace function mail_claim_address(p_member uuid, p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare existing mail_accounts%rowtype;
begin
  if p_member is null then raise exception 'not on the team' using errcode = '42501'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'that isn''t an email address'; end if;
  select * into existing from mail_accounts where lower(email) = lower(p_email);
  if found and existing.member_id is distinct from p_member then
    raise exception '% is already connected by another team member', p_email;
  end if;
  return existing.id;
end $$;

-- Gmail (from the OAuth callback, token already encrypted).
create or replace function save_my_mail_account(p_email text, p_from_name text, p_token_encrypted text) returns void
language plpgsql security definer set search_path = public as $$
declare
  m uuid := current_member_id();
  aid uuid;
begin
  aid := mail_claim_address(m, p_email);
  if coalesce(p_token_encrypted, '') !~ '^v1\.' then raise exception 'bad mail account'; end if;
  insert into mail_accounts (member_id, email, provider, from_name, refresh_token_encrypted, connected_at, active, needs_reconnect,
                             last_error, synced_until)
  values (m, lower(p_email), 'gmail', nullif(trim(p_from_name), ''), p_token_encrypted, now(), true, false, null, now() - interval '14 days')
  on conflict (email) do update set
    provider = 'gmail', refresh_token_encrypted = excluded.refresh_token_encrypted, connected_at = now(),
    active = true, needs_reconnect = false, last_error = null,
    from_name = coalesce(mail_accounts.from_name, excluded.from_name),
    synced_until = coalesce(mail_accounts.synced_until, excluded.synced_until)
  returning id into aid;
  if not exists (select 1 from mail_accounts where member_id = m and is_default) then perform mail_fix_default(m, aid); end if;
end $$;

-- GoDaddy / any IMAP+SMTP inbox (password already encrypted; the server tested the login first).
create or replace function save_my_imap_account(p_email text, p_from_name text, p_secret_encrypted text,
                                                p_imap_host text, p_imap_port int, p_smtp_host text, p_smtp_port int) returns void
language plpgsql security definer set search_path = public as $$
declare
  m uuid := current_member_id();
  aid uuid;
begin
  aid := mail_claim_address(m, p_email);
  if coalesce(p_secret_encrypted, '') !~ '^v1\.' then raise exception 'bad mail account'; end if;
  if coalesce(p_imap_host, '') !~ '^[a-z0-9.-]+$' or coalesce(p_smtp_host, '') !~ '^[a-z0-9.-]+$'
     or p_imap_port not between 1 and 65535 or p_smtp_port not between 1 and 65535 then
    raise exception 'check the server names and ports';
  end if;
  insert into mail_accounts (member_id, email, provider, from_name, refresh_token_encrypted, imap_host, imap_port, smtp_host, smtp_port,
                             connected_at, active, needs_reconnect, last_error, synced_until)
  values (m, lower(p_email), 'imap', nullif(trim(p_from_name), ''), p_secret_encrypted, lower(p_imap_host), p_imap_port,
          lower(p_smtp_host), p_smtp_port, now(), true, false, null, now() - interval '14 days')
  on conflict (email) do update set
    provider = 'imap', refresh_token_encrypted = excluded.refresh_token_encrypted,
    imap_host = excluded.imap_host, imap_port = excluded.imap_port, smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port,
    connected_at = now(), active = true, needs_reconnect = false, last_error = null,
    from_name = coalesce(mail_accounts.from_name, excluded.from_name),
    synced_until = coalesce(mail_accounts.synced_until, excluded.synced_until)
  returning id into aid;
  if not exists (select 1 from mail_accounts where member_id = m and is_default) then perform mail_fix_default(m, aid); end if;
end $$;

create or replace function save_my_mail_settings(p_account uuid, p_from_name text, p_signature text, p_daily_limit int) returns void
language plpgsql security definer set search_path = public as $$
declare m uuid := current_member_id();
begin
  if m is null then raise exception 'not on the team' using errcode = '42501'; end if;
  if length(coalesce(trim(p_signature), '')) < 20 then
    raise exception 'the signature needs your name and postal address (the law requires the address in every email)';
  end if;
  update mail_accounts set from_name = nullif(trim(p_from_name), ''), signature = trim(p_signature),
                           daily_limit = greatest(1, least(40, coalesce(p_daily_limit, 20)))
  where id = p_account and member_id = m;
  if not found then raise exception 'inbox not found'; end if;
end $$;

create or replace function set_default_mail_account(p_account uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m uuid := current_member_id();
begin
  if not exists (select 1 from mail_accounts where id = p_account and member_id = m and active) then raise exception 'inbox not found'; end if;
  perform mail_fix_default(m, p_account);
end $$;

create or replace function disconnect_my_mail_account(p_account uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m uuid := current_member_id();
begin
  update mail_accounts set refresh_token_encrypted = null, active = false, needs_reconnect = false, is_default = false
  where id = p_account and member_id = m;
  if not found then raise exception 'inbox not found'; end if;
  if not exists (select 1 from mail_accounts where member_id = m and is_default) then perform mail_fix_default(m, null); end if;
end $$;

-- Write an email; p_account picks the inbox (null: the right one is chosen at send time).
create or replace function queue_email(p_company uuid, p_contact uuid, p_subject text, p_body text,
                                       p_scheduled_for timestamptz default null, p_approve boolean default false,
                                       p_account uuid default null) returns uuid
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
  if p_account is not null and not exists (select 1 from mail_accounts where id = p_account and member_id = m and active) then
    raise exception 'you can only send from your own connected inbox' using errcode = '42501';
  end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_body), '') = '' then raise exception 'write a subject and a message'; end if;
  reason := outreach_block_reason(p_contact);
  if reason is not null then raise exception 'can''t email this contact: %', reason; end if;
  select coalesce(max(step), 0) + 1 into nstep from outreach_messages where contact_id = p_contact and status <> 'cancelled';
  insert into outreach_messages (company_id, contact_id, member_id, mail_account_id, step, subject, body, status, scheduled_for,
                                 approved_by, approved_at, source)
  values (p_company, p_contact, m, p_account, nstep, trim(p_subject), trim(p_body),
          case when p_approve then 'approved' else 'pending_approval' end, coalesce(p_scheduled_for, now()),
          case when p_approve then m::text end, case when p_approve then now() end, 'crm')
  returning id into new_id;
  return new_id;
end $$;

-- =====================================================================
-- Worker
-- =====================================================================

create or replace function mailer_accounts(secret text, p_member uuid default null) returns table (
  id uuid, member_id uuid, email text, provider text, from_name text, token text, synced_until timestamptz,
  imap_host text, imap_port int, smtp_host text, smtp_port int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  return query
    select a.id, a.member_id, a.email, a.provider, a.from_name, a.refresh_token_encrypted, a.synced_until,
           a.imap_host, a.imap_port, a.smtp_host, a.smtp_port
    from mail_accounts a
    where a.active and a.refresh_token_encrypted is not null and not a.needs_reconnect
      and (p_member is null or a.member_id = p_member)
    order by a.created_at;
end $$;

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
  update outreach_messages set status = 'failed', error = 'no confirmation from the mail server: check your Sent folder before retrying'
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
    -- Due emails by this inbox's owner that should go from THIS inbox: the one they named
    -- (if still connected), else the inbox that last emailed the contact, else the default.
    select o.* into msg from outreach_messages o
    where o.status = 'approved' and o.member_id = a.member_id and o.scheduled_for <= now()
      and coalesce((select x.id from mail_accounts x where x.id = o.mail_account_id and x.active and x.refresh_token_encrypted is not null),
                   mail_pick_account(o.member_id, o.contact_id)) = a.id
    order by o.scheduled_for, o.created_at
    limit 1 for update of o skip locked;
    exit when not found;

    reason := outreach_block_reason(msg.contact_id);
    if reason is not null then
      update outreach_messages set status = 'cancelled', error = 'blocked: ' || reason where id = msg.id;
      continue;
    end if;
    select * into ct from contacts where id = msg.contact_id;

    -- Follow-ups go in the latest thread this inbox has with the contact.
    thr := null; first_subject := null; refs := null;
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
      -- A follow-up whose first email isn't known in this inbox: never send a "Re:" that isn't a reply.
      update outreach_messages set status = 'failed',
             error = 'this is a follow-up, but the first email to this contact isn''t synced from ' || a.email || ' yet: sync, then approve it again'
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

-- ---------- who may call what ----------
do $$
declare f text;
begin
  foreach f in array array[
    'mail_pick_account(uuid,uuid)', 'mail_fix_default(uuid,uuid)', 'mail_claim_address(uuid,text)',
    'my_mail_accounts()', 'team_inboxes()', 'save_my_mail_account(text,text,text)',
    'save_my_imap_account(text,text,text,text,int,text,int)', 'save_my_mail_settings(uuid,text,text,int)',
    'set_default_mail_account(uuid)', 'disconnect_my_mail_account(uuid)',
    'queue_email(uuid,uuid,text,text,timestamptz,boolean,uuid)', 'mailer_accounts(text,uuid)', 'mailer_claim(text,uuid)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'my_mail_accounts()', 'team_inboxes()', 'save_my_mail_account(text,text,text)',
    'save_my_imap_account(text,text,text,text,int,text,int)', 'save_my_mail_settings(uuid,text,text,int)',
    'set_default_mail_account(uuid)', 'disconnect_my_mail_account(uuid)', 'queue_email(uuid,uuid,text,text,timestamptz,boolean,uuid)']
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['mailer_accounts(text,uuid)', 'mailer_claim(text,uuid)'] loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
