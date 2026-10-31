-- AgencyOS 0003 — Basic CRM v0
-- Team, lead stages, touches (with minutes spent), notes, and RLS so the web app
-- can run on the logged-in user's session. Additive and safe to re-run.
-- Run after 0001 and 0002: Supabase -> SQL Editor -> New query -> paste -> Run.

-- ---------- team ----------
create table if not exists team_members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique,                     -- auth.users.id, set by scripts/setup-team.mjs
  email       text not null,
  full_name   text,
  role        text not null default 'partner' check (role in ('owner','partner')),
  color       text not null default '#2563eb', -- shown on pipeline cards
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists team_members_email_uq on team_members (lower(email));

drop trigger if exists team_members_updated_at on team_members;
create trigger team_members_updated_at before update on team_members
  for each row execute function set_updated_at();

-- Who is calling? Matched by auth user id, or by the email in the JWT for a
-- member whose user_id isn't linked yet. SECURITY DEFINER so policies can use
-- them without recursing into team_members' own RLS.
create or replace function current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from team_members
  where active
    and (user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  order by (user_id = auth.uid()) desc nulls last
  limit 1
$$;

create or replace function is_team_member() returns boolean
language sql stable security definer set search_path = public as $$
  select current_member_id() is not null
$$;

create or replace function is_team_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where id = current_member_id() and role = 'owner')
$$;

-- ---------- stages ----------
do $$ begin
  create type crm_stage as enum (
    'new', 'researching', 'ready', 'contacted', 'replied', 'interested',
    'meeting_booked', 'proposal_sent', 'won', 'lost', 'nurture', 'disqualified'
  );
exception when duplicate_object then null; end $$;

-- Order used to move stages forward only. Side stages sit where a touch can still lift them.
create or replace function crm_stage_rank(s crm_stage) returns int
language sql immutable as $$
  select case s
    when 'new' then 0 when 'researching' then 1 when 'ready' then 2 when 'nurture' then 2
    when 'contacted' then 3 when 'replied' then 4 when 'interested' then 5
    when 'meeting_booked' then 6 when 'proposal_sent' then 7
    else 8 end   -- won, lost, disqualified: closed
$$;

-- ---------- companies: CRM columns ----------
do $$ begin
  -- 0002 called it "timezone"; the CRM uses "time_zone". Keep one column.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'timezone')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'time_zone') then
    alter table companies rename column timezone to time_zone;
  end if;
end $$;

alter table companies add column if not exists time_zone        text;
alter table companies add column if not exists lead_ref         text;
alter table companies add column if not exists osm_id           text;
alter table companies add column if not exists trade            text;
alter table companies add column if not exists email            text;
alter table companies add column if not exists stage            crm_stage not null default 'new';
alter table companies add column if not exists owner_id         uuid;
alter table companies add column if not exists next_step        text;
alter table companies add column if not exists next_step_at     timestamptz;
alter table companies add column if not exists last_touch_at    timestamptz;
alter table companies add column if not exists touches_count    int not null default 0;
alter table companies add column if not exists minutes_spent    int not null default 0;
alter table companies add column if not exists lost_reason      text;
alter table companies add column if not exists deal_value_cents bigint;
alter table companies add column if not exists deal_currency    text not null default 'USD';
alter table companies add column if not exists tags             text[] not null default '{}';
alter table companies add column if not exists opening_hours    text;
alter table companies add column if not exists facebook         text;
alter table companies add column if not exists instagram        text;
alter table companies add column if not exists linkedin         text;
alter table companies add column if not exists yelp             text;
alter table companies add column if not exists is_chain         boolean;
alter table companies add column if not exists data_license     text;
alter table companies add column if not exists enrichment       jsonb not null default '{}'::jsonb;
alter table companies add column if not exists created_by       uuid;
alter table companies add column if not exists updated_by       uuid;

do $$ begin
  alter table companies add constraint companies_deal_currency_chk check (deal_currency in ('USD','CAD'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table companies add constraint companies_owner_fk foreign key (owner_id) references team_members(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table companies add constraint companies_created_by_fk foreign key (created_by) references team_members(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table companies add constraint companies_updated_by_fk foreign key (updated_by) references team_members(id) on delete set null;
exception when duplicate_object then null; end $$;

create unique index if not exists companies_lead_ref_uq on companies (lead_ref);
create unique index if not exists companies_osm_id_uq   on companies (osm_id);
create index if not exists companies_stage_idx        on companies (stage);
create index if not exists companies_owner_idx        on companies (owner_id);
create index if not exists companies_next_step_at_idx on companies (next_step_at);
create index if not exists companies_region_trade_idx on companies (region, trade);

-- ---------- touches: every piece of work on a lead, with minutes ----------
create table if not exists touches (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  contact_id   uuid references contacts(id) on delete set null,
  member_id    uuid references team_members(id) on delete set null,
  channel      text not null check (channel in ('call','email','loom','sms','linkedin','research','meeting','proposal','other')),
  direction    text not null default 'outbound' check (direction in ('outbound','inbound','internal')),
  outcome      text not null default 'done' check (outcome in ('done','sent','no_answer','left_voicemail','replied',
                 'interested','not_interested','meeting_booked','won','lost','other')),
  minutes      int not null default 0 check (minutes between 0 and 600),
  summary      text,
  happened_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists touches_company_idx on touches (company_id, happened_at desc);
create index if not exists touches_member_idx  on touches (member_id, happened_at desc);
create index if not exists touches_happened_idx on touches (happened_at desc);

create or replace function touches_before_insert() returns trigger
language plpgsql as $$
begin
  if new.member_id is null then new.member_id := current_member_id(); end if;
  return new;
end $$;

-- Roll the touch up into the lead and move its stage FORWARD only.
-- won / lost outcomes are set directly; closed leads otherwise stay put.
create or replace function touches_after_insert() returns trigger
language plpgsql as $$
declare
  cur    crm_stage;
  target crm_stage;
  next   crm_stage;
begin
  select stage into cur from companies where id = new.company_id for update;

  target := case
    when new.outcome = 'won'  then 'won'
    when new.outcome = 'lost' then 'lost'
    when new.channel = 'proposal' then 'proposal_sent'
    when new.outcome = 'meeting_booked' then 'meeting_booked'
    when new.outcome = 'interested' then 'interested'
    when new.outcome = 'replied' then 'replied'
    when new.outcome in ('sent','no_answer','left_voicemail') then 'contacted'
    when new.channel = 'research' and cur = 'new' then 'researching'
    else null
  end::crm_stage;

  next := cur;
  if target in ('won','lost') then
    next := target;
  elsif target is not null
        and cur not in ('won','lost','disqualified')
        and crm_stage_rank(target) > crm_stage_rank(cur) then
    next := target;
  end if;

  update companies set
    touches_count = touches_count + 1,
    minutes_spent = minutes_spent + new.minutes,
    last_touch_at = greatest(coalesce(last_touch_at, new.happened_at), new.happened_at),
    stage         = next
  where id = new.company_id;
  return new;
end $$;

drop trigger if exists touches_bi on touches;
create trigger touches_bi before insert on touches for each row execute function touches_before_insert();
drop trigger if exists touches_ai on touches;
create trigger touches_ai after insert on touches for each row execute function touches_after_insert();

-- ---------- notes ----------
create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  member_id   uuid references team_members(id) on delete set null default current_member_id(),
  body        text not null check (length(body) between 1 and 10000),
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notes_company_idx on notes (company_id, created_at desc);

drop trigger if exists notes_updated_at on notes;
create trigger notes_updated_at before update on notes
  for each row execute function set_updated_at();

-- ---------- activity log: who changed stage / owner ----------
alter table activities add column if not exists member_id uuid references team_members(id) on delete set null;
create index if not exists activities_created_idx on activities (created_at desc);

create or replace function companies_track_changes() returns trigger
language plpgsql as $$
declare m uuid := current_member_id();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, m);
    new.updated_by := coalesce(new.updated_by, m);
    return new;
  end if;
  if m is not null then new.updated_by := m; end if;
  return new;
end $$;

create or replace function companies_log_changes() returns trigger
language plpgsql as $$
declare m uuid := current_member_id();
begin
  if new.stage is distinct from old.stage then
    insert into activities (company_id, type, payload, actor, member_id)
    values (new.id, 'stage_changed', jsonb_build_object('from', old.stage, 'to', new.stage),
            case when m is null then 'system' else 'user' end, m);
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into activities (company_id, type, payload, actor, member_id)
    values (new.id, 'owner_changed', jsonb_build_object('from', old.owner_id, 'to', new.owner_id),
            case when m is null then 'system' else 'user' end, m);
  end if;
  return null;
end $$;

drop trigger if exists companies_track on companies;
create trigger companies_track before insert or update on companies
  for each row execute function companies_track_changes();
drop trigger if exists companies_log on companies;
create trigger companies_log after update of stage, owner_id on companies
  for each row execute function companies_log_changes();

-- ---------- views (run as the caller, so RLS applies) ----------
create or replace view v_stage_counts with (security_invoker = true) as
select c.stage, c.owner_id, tm.full_name as owner_name,
       count(*)::int as leads, coalesce(sum(c.minutes_spent), 0)::int as minutes
from companies c
left join team_members tm on tm.id = c.owner_id
group by c.stage, c.owner_id, tm.full_name;

create or replace view v_member_time with (security_invoker = true) as
select t.member_id, tm.full_name as member_name, (t.happened_at at time zone 'UTC')::date as day,
       t.channel, t.outcome, count(*)::int as touches, coalesce(sum(t.minutes), 0)::int as minutes
from touches t
left join team_members tm on tm.id = t.member_id
group by t.member_id, tm.full_name, (t.happened_at at time zone 'UTC')::date, t.channel, t.outcome;

-- ---------- row level security ----------
-- Active team members read and write; only an owner deletes. The MCP server uses the
-- service-role key and bypasses RLS. Mail accounts, jobs, settings etc. stay service-only.
alter table team_members enable row level security;
alter table touches      enable row level security;
alter table notes        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','touches','notes','activities','website_audits',
                           'search_runs','suppressions','research_reports','deals','appointments']
  loop
    execute format('alter table %I enable row level security', t);
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
end $$;

-- The team list: everyone on the team sees it, only an owner changes it.
drop policy if exists team_select on team_members;
drop policy if exists owner_insert on team_members;
drop policy if exists owner_update on team_members;
drop policy if exists owner_delete on team_members;
create policy team_select  on team_members for select to authenticated using (is_team_member());
create policy owner_insert on team_members for insert to authenticated with check (is_team_owner());
create policy owner_update on team_members for update to authenticated using (is_team_owner()) with check (is_team_owner());
create policy owner_delete on team_members for delete to authenticated using (is_team_owner());
grant select, insert, update, delete on team_members to authenticated;

-- 0001's view ran as its owner, which skips RLS; make it run as the caller like the others.
alter view pipeline_summary set (security_invoker = true);

grant select on v_stage_counts, v_member_time, pipeline_summary to authenticated;
grant execute on function current_member_id(), is_team_member(), is_team_owner() to authenticated;
