-- 0012: tasks, deals with setup + monthly fees, sorting replies, and the booking link.
-- Run once in Supabase -> SQL Editor (safe to run again).

-- ---------- tasks ----------
create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references companies(id) on delete cascade,      -- null: a task not about one lead
  title        text not null check (length(trim(title)) between 1 and 300),
  notes        text,
  due_at       timestamptz,
  assignee_id  uuid references team_members(id) on delete set null default current_member_id(),
  created_by   uuid references team_members(id) on delete set null default current_member_id(),
  done_at      timestamptz,
  done_by      uuid references team_members(id) on delete set null,
  source       text not null default 'manual' check (source in ('manual', 'reply', 'system')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_open_idx on tasks (assignee_id, due_at) where done_at is null;
create index if not exists tasks_company_idx on tasks (company_id, created_at desc);
drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at before update on tasks for each row execute function set_updated_at();

alter table tasks enable row level security;
drop policy if exists team_select on tasks;
drop policy if exists team_insert on tasks;
drop policy if exists team_update on tasks;
drop policy if exists creator_delete on tasks;
create policy team_select on tasks for select to authenticated using (is_team_member());
create policy team_insert on tasks for insert to authenticated with check (is_team_member());
create policy team_update on tasks for update to authenticated using (is_team_member()) with check (is_team_member());
create policy creator_delete on tasks for delete to authenticated using (is_team_member() and (created_by = current_member_id() or is_team_owner()));
grant select, insert, update, delete on tasks to authenticated;

-- ---------- deals: one per lead, setup fee + monthly fee ----------
alter table deals add column if not exists offer text;
alter table deals add column if not exists won_at timestamptz;
create unique index if not exists deals_company_uq on deals (company_id);
grant select, insert, update, delete on deals to authenticated;

-- ---------- booking link (your calendar page), used in suggested replies ----------
create or replace function booking_url() returns text
language sql stable security definer set search_path = public as $$
  select case when is_team_member() then (select value #>> '{}' from settings where key = 'booking_url') end
$$;

create or replace function set_booking_url(p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_owner() then raise exception 'only an owner can change the booking link' using errcode = '42501'; end if;
  if p_url is not null and p_url !~ '^https://[^\s]+$' then raise exception 'the booking link must start with https://'; end if;
  if p_url is null then delete from settings where key = 'booking_url';
  else insert into settings (key, value) values ('booking_url', to_jsonb(p_url)) on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;

-- ---------- sorting a reply ----------
-- Labels a reply and moves the lead along:
--   interested / meeting_request -> stage interested (+ a task to send the booking link)
--   question / pricing           -> stage replied at least
--   not_now                      -> nurture, follow-ups stopped, a task to check back in 60 days
--   not_interested               -> lost, follow-ups stopped
--   unsubscribe                  -> never-contact list, do-not-contact, follow-ups stopped
create or replace function classify_reply(p_id uuid, p_class text) returns text
language plpgsql security definer set search_path = public as $$
declare
  m   uuid := current_member_id();
  msg inbound_messages%rowtype;
  co  companies%rowtype;
  ct  contacts%rowtype;
  who text;
  res text := 'Labelled';
begin
  if m is null then raise exception 'not on the team' using errcode = '42501'; end if;
  if p_class not in ('interested', 'question', 'pricing', 'meeting_request', 'not_now', 'not_interested', 'unsubscribe') then
    raise exception 'unknown label';
  end if;
  select * into msg from inbound_messages where id = p_id for update;
  if not found then raise exception 'reply not found'; end if;
  update inbound_messages set classification = p_class, classified_by = 'user',
         handled = case when p_class in ('not_now', 'not_interested', 'unsubscribe') then true else handled end
  where id = p_id;
  if msg.company_id is null then return res; end if;
  select * into co from companies where id = msg.company_id for update;
  if msg.contact_id is not null then select * into ct from contacts where id = msg.contact_id; end if;
  who := coalesce(nullif(ct.full_name, ''), msg.from_email, co.name);

  if p_class in ('interested', 'meeting_request') then
    if crm_stage_rank(co.stage) < crm_stage_rank('interested') then update companies set stage = 'interested' where id = co.id; end if;
    insert into tasks (company_id, title, due_at, assignee_id, created_by, source)
    values (co.id, 'Send ' || who || ' the booking link', now(), coalesce(co.owner_id, m), m, 'reply');
    res := 'Interested: lead moved to Interested, and a task to send the booking link';
  elsif p_class in ('question', 'pricing') then
    if crm_stage_rank(co.stage) < crm_stage_rank('replied') then update companies set stage = 'replied' where id = co.id; end if;
    res := 'Labelled: answer them from the lead''s Email card or the Mailbox';
  elsif p_class = 'not_now' then
    perform mail_stop_pending(co.id, null, now(), 'stopped: they said not now');
    if co.stage not in ('won', 'lost', 'disqualified') then update companies set stage = 'nurture' where id = co.id; end if;
    insert into tasks (company_id, title, due_at, assignee_id, created_by, source)
    values (co.id, 'Check back with ' || who, now() + interval '60 days', coalesce(co.owner_id, m), m, 'reply');
    res := 'Not now: follow-ups stopped, lead moved to Nurture, reminder in 60 days';
  elsif p_class = 'not_interested' then
    perform mail_stop_pending(co.id, null, now(), 'stopped: not interested');
    if co.stage not in ('won', 'lost', 'disqualified') then
      update companies set stage = 'lost', lost_reason = coalesce(lost_reason, 'Not interested (reply)') where id = co.id;
    end if;
    res := 'Not interested: follow-ups stopped, lead marked Lost';
  elsif p_class = 'unsubscribe' then
    perform mail_stop_pending(co.id, null, now(), 'stopped: asked not to be emailed');
    if ct.id is not null then
      update contacts set do_not_contact = true where id = ct.id;
      insert into suppressions (email, reason, contact_id) values (lower(ct.email), 'asked_not_to', ct.id) on conflict do nothing;
    elsif msg.from_email is not null then
      insert into suppressions (email, reason) values (lower(msg.from_email), 'asked_not_to') on conflict do nothing;
    end if;
    res := 'Unsubscribed: added to the never-contact list';
  end if;
  return res;
end $$;

do $$
declare f text;
begin
  foreach f in array array['booking_url()', 'set_booking_url(text)', 'classify_reply(uuid,text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
