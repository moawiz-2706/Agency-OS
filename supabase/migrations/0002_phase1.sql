-- AgencyOS 0002 — Phase 1 schema (SPEC.md "Data model")
-- Adds the 14 remaining Phase 1 tables, the new lead statuses, and the columns
-- the CSV import and compliance gates need. Safe to run more than once.
-- Paste into Supabase: SQL Editor -> New query -> Run.

-- ---------- enum additions ----------
-- New values can't be used in the same transaction they are added in,
-- so nothing below refers to them.
alter type lead_status add value if not exists 'researched' after 'review';
alter type lead_status add value if not exists 'in_sequence' after 'ready_for_outreach';
alter type lead_status add value if not exists 'do_not_contact';

-- ---------- columns on v0.1 tables ----------
alter table companies add column if not exists timezone text;          -- IANA, e.g. America/Chicago
alter table companies add column if not exists owner_id uuid;          -- multi-user later
-- Last 10 digits of the phone, for dedupe across sources ("(214) 555-0100" = "+1 214-555-0100").
alter table companies add column if not exists phone_digits text
  generated always as (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) stored;
create index if not exists companies_phone_digits_idx on companies (phone_digits);

alter table contacts add column if not exists email_status text not null default 'unknown'
  check (email_status in ('unknown','valid','risky','invalid','bounced'));  -- invalid = bad syntax or no MX
alter table contacts add column if not exists email_is_role boolean not null default false;  -- info@, office@...
alter table contacts add column if not exists verified_at timestamptz;
alter table contacts add column if not exists found_at timestamptz not null default now();  -- CASL proof: date found
alter table contacts add column if not exists source text;             -- csv file name, manual, website
alter table contacts add column if not exists unsubscribe_token uuid not null default gen_random_uuid();
alter table contacts add column if not exists owner_id uuid;
create unique index if not exists contacts_unsubscribe_token_uq on contacts (unsubscribe_token);
create index if not exists contacts_email_idx on contacts (lower(email));

alter table search_runs add column if not exists source text not null default 'google_places';
alter table search_runs add column if not exists cost_estimate_cents int not null default 0;
alter table search_runs alter column niche drop not null;

alter table website_audits add column if not exists text_extract text;
alter table website_audits add column if not exists pages_fetched text[] not null default '{}';

alter table activities add column if not exists actor text not null default 'system'
  check (actor in ('claude','user','system'));

alter table suppressions add column if not exists contact_id uuid references contacts(id) on delete set null;

-- ---------- services (your catalog) ----------
create table if not exists services (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  description           text,
  currency              text not null default 'USD' check (currency in ('USD','CAD')),
  setup_min_cents       int,
  setup_max_cents       int,
  monthly_min_cents     int,
  monthly_max_cents     int,
  deliverables          text[] not null default '{}',
  active                boolean not null default true,
  owner_id              uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------- research reports ----------
create table if not exists research_reports (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies(id) on delete cascade,
  summary                 text not null,
  services                text[] not null default '{}',
  service_area            text,
  observed                jsonb not null default '[]'::jsonb,
  inferred                jsonb not null default '[]'::jsonb,
  unknown                 jsonb not null default '[]'::jsonb,
  gaps                    jsonb not null default '[]'::jsonb,   -- [{gap, evidence_url, detail}]
  recommended_service_id  uuid references services(id) on delete set null,
  discovery_questions     text[] not null default '{}',
  hook                    text,
  confidence              numeric(3,2) check (confidence between 0 and 1),
  model                   text,
  version                 int not null default 1,
  owner_id                uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists research_reports_company_idx on research_reports (company_id, created_at desc);

-- ---------- templates ----------
create table if not exists templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  step        int not null check (step between 1 and 4),
  subject     text not null,
  body        text not null,                  -- {{merge}} fields + {{personal_line}}
  niche       text,                           -- null = any niche
  variant     text not null default 'A',
  active      boolean not null default true,
  owner_id    uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- mail accounts ----------
create table if not exists mail_accounts (
  id                       uuid primary key default gen_random_uuid(),
  email                    text not null unique,
  provider                 text not null default 'gmail' check (provider in ('gmail','microsoft')),
  from_name                text,
  refresh_token_encrypted  text,                -- AES-256-GCM; key lives only in .env
  daily_limit              int not null default 20,
  warmup_stage             int not null default 0,
  sent_today               int not null default 0,
  sent_today_date          date,
  history_id               text,                -- Gmail sync cursor
  active                   boolean not null default true,
  owner_id                 uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ---------- campaigns ----------
create table if not exists campaigns (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  niche            text,
  cities           text[] not null default '{}',
  template_ids     uuid[] not null default '{}',   -- one per step
  step_days        int[] not null default '{1,4,8,14}',
  daily_limit      int not null default 20,
  mail_account_id  uuid references mail_accounts(id) on delete set null,
  status           text not null default 'draft' check (status in ('draft','active','paused')),
  owner_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists campaign_members (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
  current_step    int not null default 0,          -- last step sent (0 = none yet)
  next_send_at    timestamptz,
  stopped_reason  text,                            -- replied, bounced, unsubscribed, manual
  owner_id        uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

-- ---------- email threads ----------
create table if not exists email_threads (
  id               uuid primary key default gen_random_uuid(),
  thread_id        text not null unique,             -- Gmail threadId
  mail_account_id  uuid references mail_accounts(id) on delete set null,
  company_id       uuid references companies(id) on delete set null,
  contact_id       uuid references contacts(id) on delete set null,
  subject          text,
  last_message_at  timestamptz,
  unread           boolean not null default false,
  handled          boolean not null default false,
  owner_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------- outreach messages ----------
create table if not exists outreach_messages (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid references campaigns(id) on delete set null,
  contact_id        uuid not null references contacts(id) on delete cascade,
  company_id        uuid not null references companies(id) on delete cascade,
  template_id       uuid references templates(id) on delete set null,
  step              int not null default 1,
  kind              text not null default 'outreach' check (kind in ('outreach','reply')),
  status            text not null default 'draft'
                    check (status in ('draft','pending_approval','approved','queued','sent','failed','cancelled')),
  subject           text not null,
  body              text not null,
  personal_line     text,
  approved_by       text,
  approved_at       timestamptz,
  scheduled_for     timestamptz,
  mail_account_id   uuid references mail_accounts(id) on delete set null,
  gmail_message_id  text,
  rfc_message_id    text,                            -- Message-ID header, for threading
  thread_id         text,
  in_reply_to       text,
  sent_at           timestamptz,
  error             text,
  idempotency_key   text not null unique,            -- campaign + contact + step
  owner_id          uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists outreach_messages_status_idx on outreach_messages (status, scheduled_for);

-- ---------- inbound messages ----------
create table if not exists inbound_messages (
  id                uuid primary key default gen_random_uuid(),
  gmail_message_id  text not null unique,
  thread_id         text,
  email_thread_id   uuid references email_threads(id) on delete set null,
  company_id        uuid references companies(id) on delete set null,
  contact_id        uuid references contacts(id) on delete set null,
  from_email        text not null,
  subject           text,
  snippet           text,
  body_text         text,
  received_at       timestamptz,
  classification    text check (classification in ('interested','question','pricing','meeting_request',
                      'not_now','not_interested','unsubscribe','out_of_office','bounce')),
  classified_by     text check (classified_by in ('claude','user','system')),
  handled           boolean not null default false,
  owner_id          uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists inbound_messages_unhandled_idx on inbound_messages (handled, received_at desc);

-- ---------- deals ----------
create table if not exists deals (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  service_id           uuid references services(id) on delete set null,
  currency             text not null default 'USD' check (currency in ('USD','CAD')),
  setup_fee_cents      int,
  monthly_fee_cents    int,
  stage                text not null default 'open' check (stage in ('open','proposal_sent','won','lost')),
  probability          numeric(3,2) check (probability between 0 and 1),
  expected_close       date,
  notes                text,
  owner_id             uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------- appointments ----------
create table if not exists appointments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid references companies(id) on delete set null,
  contact_id         uuid references contacts(id) on delete set null,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  calendar_event_id  text,
  meet_link          text,
  attendee_email     text,
  attendee_name      text,
  status             text not null default 'booked' check (status in ('booked','held','no_show','cancelled')),
  reminder_24h_sent  boolean not null default false,
  reminder_1h_sent   boolean not null default false,
  notes              text,
  outcome            text,
  owner_id           uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------- approvals ----------
create table if not exists approvals (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,          -- outreach_message, campaign, reply
  entity_id     uuid not null,
  action        text not null,          -- send, activate
  requested_by  text not null default 'claude' check (requested_by in ('claude','user')),
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_at    timestamptz,
  note          text,
  owner_id      uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists approvals_pending_idx on approvals (status, created_at);

-- ---------- jobs ----------
create table if not exists jobs (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts    int not null default 0,
  run_after   timestamptz not null default now(),
  locked_at   timestamptz,
  last_error  text,
  owner_id    uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists jobs_due_idx on jobs (status, run_after);

-- ---------- settings ----------
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into settings (key, value) values
  ('sending_enabled',          'false'),                       -- kill switch: off until you turn it on
  ('daily_google_requests',    '200'),
  ('sends_per_inbox_per_day',  '20'),
  ('sending_hours',            '{"start": 9, "end": 17}'),     -- in the lead's time zone
  ('send_gap_minutes',         '{"min": 2, "max": 6}'),
  ('business_address',         'null'),                        -- required before any send
  ('bounce_pause_threshold',   '0.03'),
  ('booking_url',              'null')
on conflict (key) do nothing;

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['services','research_reports','templates','mail_accounts','campaigns',
    'campaign_members','email_threads','outreach_messages','inbound_messages','deals','appointments',
    'approvals','jobs','settings']
  loop
    execute format('drop trigger if exists %1$s_updated_at on %1$s', t);
    execute format('create trigger %1$s_updated_at before update on %1$s
                    for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- ---------- send guard ----------
-- Last line of defence: a message can't be queued or sent to a contact who is
-- suppressed, marked do-not-contact, bounced, or has no lawful basis (SPEC "Integrity rules").
create or replace function outreach_send_guard() returns trigger
language plpgsql as $$
declare
  c  contacts%rowtype;
  co companies%rowtype;
begin
  if new.status not in ('queued','sent') then return new; end if;
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;

  select * into c from contacts where id = new.contact_id;
  if not found or c.email is null then
    raise exception 'send blocked: contact % has no email', new.contact_id;
  end if;
  if c.do_not_contact or c.email_status = 'bounced' then
    raise exception 'send blocked: % is do-not-contact or bounced', c.email;
  end if;
  if exists (select 1 from suppressions s
             where lower(s.email) = lower(c.email)
                or lower(s.domain) = lower(split_part(c.email, '@', 2))) then
    raise exception 'send blocked: % is suppressed', c.email;
  end if;
  if c.consent_basis = 'unknown' then
    raise exception 'send blocked: % has no consent basis recorded', c.email;
  end if;
  select * into co from companies where id = c.company_id;
  if co.country = 'CA' and c.consent_basis not in ('casl_implied_published','casl_implied_relationship','express') then
    raise exception 'send blocked: Canadian contact % has no CASL basis', c.email;
  end if;
  return new;
end $$;

drop trigger if exists outreach_messages_send_guard on outreach_messages;
create trigger outreach_messages_send_guard before insert or update of status on outreach_messages
  for each row execute function outreach_send_guard();

-- ---------- views ----------
create or replace view pipeline_summary as
select status, count(*)::int as companies, round(avg(score))::int as avg_score
from companies
group by status;

-- ---------- security ----------
do $$
declare t text;
begin
  foreach t in array array['services','research_reports','templates','mail_accounts','campaigns',
    'campaign_members','email_threads','outreach_messages','inbound_messages','deals','appointments',
    'approvals','jobs','settings']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
