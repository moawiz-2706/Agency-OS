-- AgencyOS v1 — lead discovery schema
-- Paste into Supabase: SQL Editor -> New query -> Run.

-- gen_random_uuid() is built into Postgres 13+ (Supabase), no extension needed.

-- ---------- enums ----------
do $$ begin
  create type lead_status as enum (
    'new',               -- just discovered
    'qualified',         -- score passed threshold
    'review',            -- medium score, needs your eyes
    'ready_for_outreach',
    'contacted',
    'replied',
    'interested',
    'meeting_booked',
    'proposal_sent',
    'won',
    'lost',
    'disqualified'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type consent_basis as enum (
    'unknown',
    'can_spam_b2b',           -- US: cold B2B allowed with opt-out + address
    'casl_implied_published', -- CA: address conspicuously published, no "no spam" notice, message relevant to role
    'casl_implied_relationship',
    'express'                 -- they opted in
  );
exception when duplicate_object then null; end $$;

-- ---------- helpers ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- search runs ----------
create table if not exists search_runs (
  id            uuid primary key default gen_random_uuid(),
  niche         text not null,
  query         text not null,
  city          text,
  country       text check (country in ('US','CA')),
  results_count int  not null default 0,
  new_count     int  not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------- companies (one row per business) ----------
create table if not exists companies (
  id                     uuid primary key default gen_random_uuid(),
  google_place_id        text unique,           -- dedupe key from Places
  name                   text not null,
  niche                  text,                  -- e.g. 'hvac', 'roofing'
  primary_type           text,
  types                  text[] not null default '{}',
  address                text,
  city                   text,
  region                 text,                  -- state / province code
  country                text check (country in ('US','CA')),
  postal_code            text,
  lat                    double precision,
  lng                    double precision,
  phone                  text,
  website                text,
  website_domain         text,                  -- normalized, for dedupe
  google_maps_uri        text,
  rating                 numeric(2,1),
  review_count           int,
  business_status        text,
  -- pipeline
  status                 lead_status not null default 'new',
  score                  int check (score between 0 and 100),
  tier                   text check (tier in ('high','medium','low')),
  score_breakdown        jsonb not null default '{}'::jsonb,
  notes                  text,
  -- provenance
  source                 text not null default 'google_places',
  first_search_run_id    uuid references search_runs(id) on delete set null,
  google_data_fetched_at timestamptz,
  last_audited_at        timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists companies_status_idx  on companies (status);
create index if not exists companies_score_idx   on companies (score desc nulls last);
create index if not exists companies_city_idx    on companies (country, region, city);
create index if not exists companies_niche_idx   on companies (niche);
create index if not exists companies_domain_idx  on companies (website_domain);

drop trigger if exists companies_updated_at on companies;
create trigger companies_updated_at before update on companies
  for each row execute function set_updated_at();

-- ---------- contacts ----------
create table if not exists contacts (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies(id) on delete cascade,
  full_name               text,
  role                    text,                 -- owner, office manager...
  email                   text,
  phone                   text,
  source_url              text,                 -- where you found it (keep for CASL)
  email_published_publicly boolean not null default false,
  consent_basis           consent_basis not null default 'unknown',
  do_not_contact          boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists contacts_company_email_uq
  on contacts (company_id, lower(email)) where email is not null;

drop trigger if exists contacts_updated_at on contacts;
create trigger contacts_updated_at before update on contacts
  for each row execute function set_updated_at();

-- ---------- website audits ----------
create table if not exists website_audits (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  url           text not null,
  final_url     text,
  http_status   int,
  signals       jsonb not null default '{}'::jsonb,
  error         text,
  fetched_at    timestamptz not null default now()
);

create index if not exists website_audits_company_idx
  on website_audits (company_id, fetched_at desc);

-- ---------- activity log ----------
create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id) on delete cascade,
  type        text not null,                    -- discovered, audited, scored, status_changed, note...
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists activities_company_idx on activities (company_id, created_at desc);

-- ---------- suppression list (never contact) ----------
create table if not exists suppressions (
  id          uuid primary key default gen_random_uuid(),
  email       text,
  domain      text,
  reason      text not null,                    -- unsubscribed, bounced, asked_not_to...
  created_at  timestamptz not null default now(),
  check (email is not null or domain is not null)
);

create unique index if not exists suppressions_email_uq  on suppressions (lower(email))  where email  is not null;
create unique index if not exists suppressions_domain_uq on suppressions (lower(domain)) where domain is not null;

-- ---------- pipeline view ----------
create or replace view pipeline_summary as
select status, count(*)::int as companies, round(avg(score))::int as avg_score
from companies
group by status;

-- ---------- security ----------
-- RLS on, no public policies: only the service-role key (used by the MCP
-- server on your machine) can read/write. Add policies later for a dashboard.
alter table search_runs    enable row level security;
alter table companies      enable row level security;
alter table contacts       enable row level security;
alter table website_audits enable row level security;
alter table activities     enable row level security;
alter table suppressions   enable row level security;
