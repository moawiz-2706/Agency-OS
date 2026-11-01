-- 0008: one-click unsubscribe, and sending pauses itself when bounces spike.
-- Run once in Supabase -> SQL Editor (safe to run again).
--
-- * Every outreach email carries a List-Unsubscribe link (Gmail and Yahoo expect one from
--   senders). Clicking it adds the address to the never-contact list, marks its contacts
--   do-not-contact and cancels anything still waiting to go to them. The web app checks
--   the link's signature, then calls mailer_unsubscribe with the worker secret.
-- * Bounce guard: when 2+ emails bounce in 24 hours and that's over 3% of what was sent,
--   sending switches off and the Account page says why. Turning it back on clears that.

-- ---------- unsubscribe ----------
create or replace function mailer_unsubscribe(secret text, p_email text) returns int
language plpgsql security definer set search_path = public as $$
declare
  addr text := lower(trim(p_email));
  ct   contacts%rowtype;
  n    int := 0;
begin
  perform mailer_check(secret);
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad email address'; end if;
  insert into suppressions (email, reason) values (addr, 'unsubscribed') on conflict do nothing;
  for ct in select * from contacts where lower(email) = addr loop
    update contacts set do_not_contact = true where id = ct.id and not do_not_contact;
    perform mail_stop_pending(null, ct.id, now(), 'stopped: they unsubscribed');
    insert into activities (company_id, type, payload, actor)
    values (ct.company_id, 'unsubscribed', jsonb_build_object('email', addr), 'system');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- bounce guard ----------
create or replace function mail_bounce_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bounces int;
  sent    int;
begin
  if new.classification is distinct from 'bounce' or not sending_enabled() then return new; end if;
  select count(*) into bounces from inbound_messages
  where classification = 'bounce' and coalesce(received_at, created_at) > now() - interval '24 hours';
  select count(*) into sent from outreach_messages where status = 'sent' and sent_at > now() - interval '24 hours';
  if bounces >= 2 and bounces > 0.03 * greatest(sent, 1) then
    insert into settings (key, value) values ('sending_enabled', 'false')
    on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into settings (key, value)
    values ('sending_paused', jsonb_build_object(
      'reason', format('%s emails bounced in the last 24 hours (%s sent). Check the addresses before turning sending back on.', bounces, sent),
      'at', now()))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists inbound_bounce_guard on inbound_messages;
create trigger inbound_bounce_guard after insert on inbound_messages
for each row execute function mail_bounce_guard();

-- Turning sending on (owner only) clears an automatic pause.
create or replace function set_sending_enabled(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_owner() then raise exception 'only an owner can turn sending on or off' using errcode = '42501'; end if;
  insert into settings (key, value) values ('sending_enabled', to_jsonb(coalesce(p_on, false)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if p_on then delete from settings where key = 'sending_paused'; end if;
end $$;

-- Why sending was switched off automatically (null when it wasn't).
create or replace function sending_pause_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_team_member() then (select value from settings where key = 'sending_paused') end
$$;

-- ---------- who may call what ----------
do $$
declare f text;
begin
  foreach f in array array['mailer_unsubscribe(text,text)', 'mail_bounce_guard()', 'set_sending_enabled(boolean)', 'sending_pause_info()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  grant execute on function set_sending_enabled(boolean) to authenticated;
  grant execute on function sending_pause_info() to authenticated;
  grant execute on function mailer_unsubscribe(text, text) to anon, authenticated;
end $$;
