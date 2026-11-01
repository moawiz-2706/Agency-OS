-- 0009: "Schedule send" for email written in the Mailbox.
-- Run once in Supabase -> SQL Editor (safe to run again).
--
-- The Mailbox checks the recipients and builds the final text when you schedule; the
-- mail worker (every 5 minutes) sends it from the same inbox once it's due. Like any
-- hand-written email it doesn't wait for the team sending switch, but it's checked again
-- at send time: anyone added to the never-contact list or marked do-not-contact or
-- bounced meanwhile makes it fail instead of sending. No attachments (nothing is stored
-- but text).

create table if not exists scheduled_mail (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references team_members(id) on delete cascade,
  mail_account_id  uuid not null references mail_accounts(id) on delete cascade,
  to_addrs         text[] not null,
  cc_addrs         text[] not null default '{}',
  bcc_addrs        text[] not null default '{}',
  subject          text not null,
  body             text not null,          -- final text: message, signature, opt-out line, quote
  in_reply_to      text,
  "references"     text,
  send_at          timestamptz not null,
  status           text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  error            text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists scheduled_mail_due_idx on scheduled_mail (status, send_at);
alter table scheduled_mail enable row level security;   -- no policies: only the functions below

-- ---------- team members: their own scheduled email ----------
create or replace function schedule_my_mail(p_account uuid, p_to text[], p_cc text[], p_bcc text[], p_subject text, p_body text,
                                            p_in_reply_to text, p_references text, p_send_at timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m uuid := current_member_id();
  new_id uuid;
begin
  if m is null then raise exception 'not on the team' using errcode = '42501'; end if;
  if not exists (select 1 from mail_accounts where id = p_account and member_id = m and active) then
    raise exception 'you can only send from your own connected inbox' using errcode = '42501';
  end if;
  if coalesce(array_length(p_to, 1), 0) = 0 then raise exception 'add at least one address in To'; end if;
  if coalesce(array_length(p_to, 1), 0) + coalesce(array_length(p_cc, 1), 0) + coalesce(array_length(p_bcc, 1), 0) > 20 then
    raise exception 'up to 20 recipients per email';
  end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_body), '') = '' then raise exception 'write a subject and a message'; end if;
  if p_send_at is null or p_send_at < now() - interval '1 minute' then raise exception 'pick a time in the future'; end if;
  if p_send_at > now() + interval '90 days' then raise exception 'pick a time within the next 90 days'; end if;
  insert into scheduled_mail (member_id, mail_account_id, to_addrs, cc_addrs, bcc_addrs, subject, body, in_reply_to, "references", send_at)
  values (m, p_account, p_to, coalesce(p_cc, '{}'), coalesce(p_bcc, '{}'), trim(p_subject), p_body, p_in_reply_to, p_references, p_send_at)
  returning id into new_id;
  return new_id;
end $$;

create or replace function my_scheduled_mail(p_account uuid) returns table (
  id uuid, to_addrs text[], cc_addrs text[], subject text, body text, send_at timestamptz, status text, error text, sent_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.to_addrs, s.cc_addrs, s.subject, s.body, s.send_at, s.status, s.error, s.sent_at
  from scheduled_mail s
  where s.member_id = current_member_id() and s.mail_account_id = p_account
    and (s.status in ('scheduled', 'sending', 'failed') or s.send_at > now() - interval '7 days')
    and s.status <> 'cancelled'
  order by s.send_at
$$;

create or replace function cancel_my_scheduled_mail(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update scheduled_mail set status = 'cancelled'
  where id = p_id and member_id = current_member_id() and status in ('scheduled', 'failed');
  if not found then raise exception 'that email isn''t waiting to be sent any more'; end if;
end $$;

-- ---------- worker ----------
-- The next due email for this inbox, re-checked against the never-contact rules.
create or replace function mailer_claim_scheduled(secret text, p_account uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s scheduled_mail%rowtype;
  bad text;
begin
  perform mailer_check(secret);
  update scheduled_mail set status = 'failed', error = 'no confirmation from the mail server: check your Sent folder before retrying'
  where status = 'sending' and send_at < now() - interval '15 minutes';
  loop
    select * into s from scheduled_mail
    where mail_account_id = p_account and status = 'scheduled' and send_at <= now()
    order by send_at limit 1 for update skip locked;
    if not found then return null; end if;
    select a into bad from unnest(s.to_addrs || s.cc_addrs || s.bcc_addrs) a
    where exists (select 1 from suppressions x where lower(x.email) = lower(a) or lower(x.domain) = lower(split_part(a, '@', 2)))
       or exists (select 1 from contacts c where lower(c.email) = lower(a) and (c.do_not_contact or c.email_status in ('bounced', 'invalid')))
    limit 1;
    if bad is not null then
      update scheduled_mail set status = 'failed', error = bad || ' is now on the never-contact list, do-not-contact or bounced' where id = s.id;
      continue;
    end if;
    update scheduled_mail set status = 'sending' where id = s.id;
    return jsonb_build_object('id', s.id, 'to', s.to_addrs, 'cc', s.cc_addrs, 'bcc', s.bcc_addrs, 'subject', s.subject,
                              'body', s.body, 'in_reply_to', s.in_reply_to, 'references', s."references");
  end loop;
end $$;

create or replace function mailer_scheduled_result(secret text, p_id uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  update scheduled_mail set status = case when p_ok then 'sent' else 'failed' end,
                            sent_at = case when p_ok then now() end, error = case when p_ok then null else left(p_error, 500) end
  where id = p_id and status = 'sending';
end $$;

-- ---------- who may call what ----------
do $$
declare f text;
begin
  foreach f in array array[
    'schedule_my_mail(uuid,text[],text[],text[],text,text,text,text,timestamptz)', 'my_scheduled_mail(uuid)',
    'cancel_my_scheduled_mail(uuid)', 'mailer_claim_scheduled(text,uuid)', 'mailer_scheduled_result(text,uuid,boolean,text)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'schedule_my_mail(uuid,text[],text[],text[],text,text,text,text,timestamptz)', 'my_scheduled_mail(uuid)', 'cancel_my_scheduled_mail(uuid)']
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['mailer_claim_scheduled(text,uuid)', 'mailer_scheduled_result(text,uuid,boolean,text)'] loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
