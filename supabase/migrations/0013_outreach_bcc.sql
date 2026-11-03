-- 0013: "BCC a copy of every outreach email to…", per inbox (e.g. so a partner sees what goes out).
-- Run once in Supabase -> SQL Editor (safe to run again).
-- Applies to emails the worker sends (sequences, AI drafts, emails approved on a lead); hand-written
-- Mailbox email has its own Bcc field.

alter table mail_accounts add column if not exists bcc_email text;
do $$ begin
  alter table mail_accounts add constraint mail_accounts_bcc_chk check (bcc_email is null or bcc_email ~ '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$');
exception when duplicate_object then null; end $$;

-- The owner of an inbox sets or clears it (null / empty = no copy).
create or replace function set_my_inbox_bcc(p_account uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare addr text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if addr is not null and addr !~ '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$' then raise exception 'that BCC address isn''t valid'; end if;
  update mail_accounts set bcc_email = addr where id = p_account and member_id = current_member_id();
  if not found then raise exception 'inbox not found' using errcode = '42501'; end if;
end $$;

create or replace function my_inbox_bcc() returns table (id uuid, bcc_email text)
language sql stable security definer set search_path = public as $$
  select a.id, a.bcc_email from mail_accounts a where a.member_id = current_member_id()
$$;

-- The worker's view of each inbox, now with the BCC address.
drop function if exists mailer_accounts(text, uuid);
create function mailer_accounts(secret text, p_member uuid default null) returns table (
  id uuid, member_id uuid, email text, provider text, from_name text, token text, synced_until timestamptz,
  imap_host text, imap_port int, smtp_host text, smtp_port int, bcc_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  return query
    select a.id, a.member_id, a.email, a.provider, a.from_name, a.refresh_token_encrypted, a.synced_until,
           a.imap_host, a.imap_port, a.smtp_host, a.smtp_port, a.bcc_email
    from mail_accounts a
    where a.active and a.refresh_token_encrypted is not null and not a.needs_reconnect
      and (p_member is null or a.member_id = p_member)
    order by a.created_at;
end $$;

do $$
declare f text;
begin
  foreach f in array array['set_my_inbox_bcc(uuid,text)', 'my_inbox_bcc()', 'mailer_accounts(text,uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  grant execute on function set_my_inbox_bcc(uuid, text) to authenticated;
  grant execute on function my_inbox_bcc() to authenticated;
  grant execute on function mailer_accounts(text, uuid) to anon, authenticated;
end $$;
