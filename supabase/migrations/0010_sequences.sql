-- 0010: email sequences. Write the steps once (with merge fields), add leads, and the
-- CRM drafts every email for every lead, scheduled in each lead's own time zone.
-- Run once in Supabase -> SQL Editor (safe to run again).
--
-- * A sequence is a `campaigns` row; its steps are `templates` rows in `template_ids`
--   order, sent on the days in `step_days` (day 1, 4, 8, 14...), at `send_time` lead-local,
--   moved off weekends.
-- * Adding leads creates drafts ("needs approval") from the adding member's inbox. Nothing
--   goes out until they're approved, and the usual send rules still apply at send time.
--   A reply, bounce or unsubscribe still stops the rest (mail_stop_pending, 0006).
-- * Merge fields: {{first_name}} {{full_name}} {{company}} {{city}} {{trade}}
--   {{personal_line}} (the research report's hook) {{my_name}} {{website}}.

alter table templates drop constraint if exists templates_step_check;
alter table templates alter column step set default 1;
alter table templates alter column name set default 'Step';

alter table campaigns add column if not exists description   text;
alter table campaigns add column if not exists send_time     time not null default '08:00';
alter table campaigns add column if not exists skip_weekends boolean not null default true;
alter table campaigns add column if not exists created_by    uuid references team_members(id) on delete set null default current_member_id();

alter table campaign_members add column if not exists member_id uuid references team_members(id) on delete set null;
create index if not exists outreach_messages_campaign_idx on outreach_messages (campaign_id, status);

-- Team members manage sequences and their steps; only owners delete them.
do $$
declare t text;
begin
  foreach t in array array['templates', 'campaigns'] loop
    execute format('drop policy if exists team_select on %I', t);
    execute format('drop policy if exists team_insert on %I', t);
    execute format('drop policy if exists team_update on %I', t);
    execute format('drop policy if exists owner_delete on %I', t);
    execute format('create policy team_select on %I for select to authenticated using (is_team_member())', t);
    execute format('create policy team_insert on %I for insert to authenticated with check (is_team_member())', t);
    execute format('create policy team_update on %I for update to authenticated using (is_team_member()) with check (is_team_member())', t);
    execute format('create policy owner_delete on %I for delete to authenticated using (is_team_owner())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
  drop policy if exists team_select on campaign_members;
  create policy team_select on campaign_members for select to authenticated using (is_team_member());
  revoke all on campaign_members from anon, authenticated;
  grant select on campaign_members to authenticated;
end $$;

-- ---------- merge fields ----------
create or replace function merge_template(p_text text, p_company uuid, p_contact uuid, p_member uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  co companies%rowtype;
  ct contacts%rowtype;
  me text;
  hook text;
  fname text;
  res text := coalesce(p_text, '');
begin
  if not is_team_member() then return null; end if;
  select * into co from companies where id = p_company;
  select * into ct from contacts where id = p_contact;
  select split_part(trim(full_name), ' ', 1) into me from team_members where id = p_member;
  select r.hook into hook from research_reports r where r.company_id = p_company order by r.updated_at desc limit 1;
  fname := nullif(split_part(trim(coalesce(ct.full_name, '')), ' ', 1), '');
  res := replace(res, '{{first_name}}', coalesce(fname, 'there'));
  res := replace(res, '{{full_name}}', coalesce(nullif(trim(ct.full_name), ''), 'there'));
  res := replace(res, '{{company}}', coalesce(co.name, 'your company'));
  res := replace(res, '{{city}}', coalesce(nullif(trim(co.city), ''), 'your area'));
  res := replace(res, '{{trade}}', coalesce(nullif(trim(co.trade), ''), nullif(trim(co.niche), ''), 'home service'));
  res := replace(res, '{{website}}', coalesce(nullif(trim(co.website), ''), 'your website'));
  res := replace(res, '{{personal_line}}', coalesce(trim(hook), ''));
  res := replace(res, '{{my_name}}', coalesce(me, ''));
  -- An empty personal line shouldn't leave a gap.
  res := regexp_replace(res, E'\\n[ \\t]*\\n([ \\t]*\\n)+', E'\n\n', 'g');
  return trim(res);
end $$;

-- ---------- adding leads ----------
create or replace function enroll_in_sequence(p_campaign uuid, p_companies uuid[], p_start date default null,
                                              p_account uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m        uuid := current_member_id();
  cp       campaigns%rowtype;
  co       companies%rowtype;
  ct       contacts%rowtype;
  t        templates%rowtype;
  tz       text;
  base     date;
  send_at  timestamptz;
  first_subject text;
  nstep    int;
  steps    int;
  n_done   int := 0;
  skipped  jsonb := '[]'::jsonb;
begin
  if m is null then raise exception 'not on the team' using errcode = '42501'; end if;
  select * into cp from campaigns where id = p_campaign;
  if not found then raise exception 'sequence not found'; end if;
  if cp.status = 'paused' then raise exception 'this sequence is paused'; end if;
  steps := coalesce(array_length(cp.template_ids, 1), 0);
  if steps = 0 then raise exception 'add at least one step to the sequence first'; end if;
  if coalesce(array_length(cp.step_days, 1), 0) < steps then raise exception 'every step needs a day'; end if;
  if coalesce(trim((select subject from templates where id = cp.template_ids[1])), '') = '' then
    raise exception 'the first step needs a subject';
  end if;
  if p_account is not null and not exists (select 1 from mail_accounts where id = p_account and member_id = m and active) then
    raise exception 'you can only send from your own connected inbox' using errcode = '42501';
  end if;
  if coalesce(array_length(p_companies, 1), 0) > 200 then raise exception 'add up to 200 leads at a time'; end if;

  for co in select * from companies where id = any(p_companies) order by name loop
    if co.stage in ('won', 'lost', 'disqualified') then
      skipped := skipped || jsonb_build_object('company', co.name, 'reason', 'the lead is closed'); continue;
    end if;
    -- The best contact that can be emailed: a named person before a shared inbox.
    select c.* into ct from contacts c
    where c.company_id = co.id and c.email is not null and outreach_block_reason(c.id) is null
    order by coalesce(c.email_is_role, false), (c.full_name is null), c.created_at
    limit 1;
    if not found then
      skipped := skipped || jsonb_build_object('company', co.name, 'reason', 'no contact that can be emailed (missing email, consent, do-not-contact or bounced)');
      continue;
    end if;
    if exists (select 1 from campaign_members x where x.campaign_id = cp.id and x.contact_id = ct.id) then
      skipped := skipped || jsonb_build_object('company', co.name, 'reason', 'already in this sequence'); continue;
    end if;
    if exists (select 1 from outreach_messages o where o.contact_id = ct.id and o.status in ('pending_approval', 'approved', 'queued')) then
      skipped := skipped || jsonb_build_object('company', co.name, 'reason', 'already has emails waiting'); continue;
    end if;

    insert into campaign_members (campaign_id, contact_id, company_id, member_id, current_step, next_send_at)
    values (cp.id, ct.id, co.id, m, 0, null);

    tz := coalesce(nullif(co.time_zone, ''), 'America/New_York');
    -- Day 1 is the start date (default today, lead-local); if its send time has passed, tomorrow.
    base := coalesce(p_start, (now() at time zone tz)::date);
    while ((base + cp.send_time) at time zone tz) < now() loop base := base + 1; end loop;
    select coalesce(max(step), 0) into nstep from outreach_messages where contact_id = ct.id and status <> 'cancelled';
    first_subject := null;

    for i in 1..steps loop
      select * into t from templates where id = cp.template_ids[i];
      if not found then raise exception 'step % of the sequence is missing', i; end if;
      send_at := ((base + (cp.step_days[i] - cp.step_days[1])) + cp.send_time) at time zone tz;
      while cp.skip_weekends and extract(isodow from (send_at at time zone tz)) in (6, 7) loop send_at := send_at + interval '1 day'; end loop;
      if i = 1 then first_subject := merge_template(t.subject, co.id, ct.id, m); end if;
      insert into outreach_messages (company_id, contact_id, member_id, mail_account_id, campaign_id, template_id, step,
                                     subject, body, status, scheduled_for, source)
      values (co.id, ct.id, m, p_account, cp.id, t.id, nstep + i,
              case when i = 1 or coalesce(trim(t.subject), '') = '' then
                     case when i = 1 then first_subject else 'Re: ' || first_subject end
                   else merge_template(t.subject, co.id, ct.id, m) end,
              merge_template(t.body, co.id, ct.id, m), 'pending_approval', send_at, 'crm');
    end loop;
    update campaign_members set next_send_at = (select min(scheduled_for) from outreach_messages where campaign_id = cp.id and contact_id = ct.id)
    where campaign_id = cp.id and contact_id = ct.id;
    n_done := n_done + 1;
  end loop;

  if n_done > 0 and cp.status = 'draft' then update campaigns set status = 'active' where id = cp.id; end if;
  return jsonb_build_object('enrolled', n_done, 'skipped', skipped);
end $$;

-- Approve all of my drafts in a sequence (each goes through approve_email's checks).
create or replace function approve_sequence_drafts(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m uuid := current_member_id();
  msg_id uuid;
  ok int := 0;
  bad int := 0;
begin
  if m is null then raise exception 'not on the team' using errcode = '42501'; end if;
  for msg_id in select o.id from outreach_messages o
            where o.campaign_id = p_campaign and o.member_id = m and o.status = 'pending_approval' order by o.scheduled_for loop
    begin
      perform approve_email(msg_id, false);
      ok := ok + 1;
    exception when others then
      bad := bad + 1;
    end;
  end loop;
  return jsonb_build_object('approved', ok, 'blocked', bad);
end $$;

-- Take a lead out of a sequence: its emails that haven't gone yet are cancelled.
create or replace function remove_from_sequence(p_campaign uuid, p_company uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_team_member() then raise exception 'not on the team' using errcode = '42501'; end if;
  update outreach_messages set status = 'cancelled', error = 'removed from the sequence'
  where campaign_id = p_campaign and company_id = p_company and status in ('draft', 'pending_approval', 'approved', 'failed');
  get diagnostics n = row_count;
  update campaign_members set stopped_reason = 'manual' where campaign_id = p_campaign and company_id = p_company;
  return n;
end $$;

-- Pausing a sequence holds its approved emails; resuming lets them go again.
create or replace function set_sequence_status(p_campaign uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_member() then raise exception 'not on the team' using errcode = '42501'; end if;
  if p_status not in ('active', 'paused') then raise exception 'unknown status'; end if;
  update campaigns set status = p_status where id = p_campaign;
  if p_status = 'paused' then
    update outreach_messages set status = 'pending_approval', approved_by = null, approved_at = null, error = 'sequence paused: approve again to send'
    where campaign_id = p_campaign and status = 'approved';
  end if;
end $$;

-- Numbers for the sequences page.
create or replace function sequence_summary() returns table (
  campaign_id uuid, leads int, needs_approval int, scheduled int, sent int, replied int, stopped int)
language sql stable security definer set search_path = public as $$
  select c.id,
    (select count(*)::int from campaign_members x where x.campaign_id = c.id),
    (select count(*)::int from outreach_messages o where o.campaign_id = c.id and o.status = 'pending_approval'),
    (select count(*)::int from outreach_messages o where o.campaign_id = c.id and o.status in ('approved', 'queued')),
    (select count(*)::int from outreach_messages o where o.campaign_id = c.id and o.status = 'sent'),
    (select count(distinct x.contact_id)::int from campaign_members x
       join inbound_messages i on i.contact_id = x.contact_id and i.received_at > x.created_at
       where x.campaign_id = c.id and coalesce(i.classification, '') not in ('bounce', 'out_of_office')),
    (select count(distinct o.contact_id)::int from outreach_messages o where o.campaign_id = c.id and o.status = 'cancelled')
  from campaigns c
  where is_team_member()
$$;

do $$
declare f text;
begin
  foreach f in array array['merge_template(text,uuid,uuid,uuid)', 'enroll_in_sequence(uuid,uuid[],date,uuid)',
    'approve_sequence_drafts(uuid)', 'remove_from_sequence(uuid,uuid)', 'set_sequence_status(uuid,text)', 'sequence_summary()']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
