-- AgencyOS 0004 — research + offer recommendations
-- Extends research_reports (created in 0002, team RLS from 0003) and adds the
-- offer recommendations the website audit stores on each lead. Safe to re-run.
-- Run after 0001-0003: Supabase -> SQL Editor -> New query -> paste -> Run.

-- ---------- companies ----------
-- Top offers from the audit rules, best first: [{key, title, priority, reasons[]}].
alter table companies add column if not exists recommended_offers jsonb not null default '[]'::jsonb;
create index if not exists companies_recommended_offers_idx on companies using gin (recommended_offers jsonb_path_ops);
-- Google rating / review count reuse companies.rating and review_count; this is where they were read.
alter table companies add column if not exists reviews_source_url text;

-- ---------- research_reports ----------
alter table research_reports add column if not exists recommended_offer text;
alter table research_reports add column if not exists source text not null default 'claude';
alter table research_reports add column if not exists created_by uuid default current_member_id();
-- Everything else a research source gave us (second offer, quality notes, etc.), so nothing is lost.
alter table research_reports add column if not exists raw jsonb not null default '{}'::jsonb;

do $$ begin
  alter table research_reports add constraint research_reports_offer_chk check (recommended_offer is null or recommended_offer in (
    'online_booking', 'missed_call_textback', 'speed_to_lead', 'review_automation',
    'website_gbp', 'ghl_optimisation', 'fsm_integration'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table research_reports add constraint research_reports_source_chk check (source in ('claude', 'external_ai', 'manual'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table research_reports add constraint research_reports_created_by_fk foreign key (created_by) references team_members(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists research_reports_latest_idx on research_reports (company_id, source, created_at desc);

drop trigger if exists research_reports_updated_at on research_reports;
create trigger research_reports_updated_at before update on research_reports
  for each row execute function set_updated_at();

-- RLS: same rules as every CRM table (0003). Re-stated so this file stands on its own.
alter table research_reports enable row level security;
drop policy if exists team_select on research_reports;
drop policy if exists team_insert on research_reports;
drop policy if exists team_update on research_reports;
drop policy if exists owner_delete on research_reports;
create policy team_select  on research_reports for select to authenticated using (is_team_member());
create policy team_insert  on research_reports for insert to authenticated with check (is_team_member());
create policy team_update  on research_reports for update to authenticated using (is_team_member()) with check (is_team_member());
create policy owner_delete on research_reports for delete to authenticated using (is_team_owner());
grant select, insert, update, delete on research_reports to authenticated;
