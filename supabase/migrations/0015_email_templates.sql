-- 0015: two email designs (cold outreach + marketing), chosen per sequence or per email,
-- and fixing scheduled emails from the Templates page. Re-runnable.
--   * settings('email_design')    = the cold-outreach design (0014)
--   * settings('email_marketing') = the branded marketing design: header, tagline, button
--   * outreach_messages.design / campaigns.design: 'outreach' | 'marketing' (null = outreach)

insert into settings (key, value)
values ('email_marketing', '{"header":"THE SENTINEL SYSTEMS","tagline":"Business Automation · CRM · AI Solutions","cta_text":"Book a free consultation","cta_url":null,"accent":"#1d4ed8"}'::jsonb)
on conflict (key) do nothing;

alter table outreach_messages add column if not exists design text;
alter table campaigns add column if not exists design text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outreach_messages_design_chk') then
    alter table outreach_messages add constraint outreach_messages_design_chk check (design in ('outreach', 'marketing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaigns_design_chk') then
    alter table campaigns add constraint campaigns_design_chk check (design in ('outreach', 'marketing'));
  end if;
end $$;

create or replace function email_marketing() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_team_member() then (select value from settings where key = 'email_marketing') end
$$;

create or replace function set_email_marketing(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_header text := btrim(coalesce(p->>'header', ''));
  v_tagline text := btrim(coalesce(p->>'tagline', ''));
  v_cta text := btrim(coalesce(p->>'cta_text', ''));
  v_url text := nullif(btrim(coalesce(p->>'cta_url', '')), '');
  v_accent text := coalesce(p->>'accent', '#1d4ed8');
begin
  if not is_team_owner() then raise exception 'only an owner can change the email design' using errcode = '42501'; end if;
  if v_header = '' or length(v_header) > 60 then raise exception 'the header needs 1 to 60 characters'; end if;
  if length(v_tagline) > 100 then raise exception 'keep the tagline under 100 characters'; end if;
  if length(v_cta) > 40 then raise exception 'keep the button text under 40 characters'; end if;
  if v_url is not null and v_url !~ '^https://[^\s]+$' then raise exception 'the button link must start with https://'; end if;
  if v_accent !~ '^#[0-9a-fA-F]{6}$' then raise exception 'the accent colour must look like #1d4ed8'; end if;
  insert into settings (key, value)
  values ('email_marketing', jsonb_build_object('header', v_header, 'tagline', v_tagline, 'cta_text', v_cta, 'cta_url', v_url, 'accent', lower(v_accent)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- Fix a waiting email from the Templates page: its author, or an owner. An approved email
-- that someone else changes goes back to its author for approval (it sends from their inbox).
create or replace function team_update_email(p_id uuid, p_subject text, p_body text, p_design text) returns text
language plpgsql security definer set search_path = public as $$
declare
  m uuid := current_member_id();
  msg outreach_messages%rowtype;
  back boolean;
begin
  select * into msg from outreach_messages where id = p_id for update;
  if not found then raise exception 'email not found'; end if;
  if m is null or (msg.member_id is distinct from m and not is_team_owner()) then
    raise exception 'only its author or an owner can edit an email' using errcode = '42501';
  end if;
  if msg.status not in ('draft', 'pending_approval', 'approved', 'failed') then raise exception 'this email is already %', msg.status; end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_body), '') = '' then raise exception 'write a subject and a message'; end if;
  if p_design is not null and p_design not in ('outreach', 'marketing') then raise exception 'unknown design: %', p_design; end if;
  back := msg.member_id is distinct from m and msg.status = 'approved';
  update outreach_messages set subject = trim(p_subject), body = trim(p_body), design = p_design, error = null,
         status = case when status = 'failed' or back then 'pending_approval' else status end,
         approved_by = case when back then null else approved_by end,
         approved_at = case when back then null else approved_at end
  where id = p_id;
  return case when back then 'needs_approval' else 'saved' end;
end $$;

-- The design for many waiting emails at once (author or owner; doesn't change approval).
create or replace function set_emails_design(p_ids uuid[], p_design text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if current_member_id() is null then raise exception 'not a team member' using errcode = '42501'; end if;
  if p_design is not null and p_design not in ('outreach', 'marketing') then raise exception 'unknown design: %', p_design; end if;
  update outreach_messages set design = p_design
  where id = any(p_ids) and status in ('draft', 'pending_approval', 'approved', 'failed')
    and (member_id = current_member_id() or is_team_owner());
  get diagnostics n = row_count;
  return n;
end $$;

-- For the mail worker: both designs and the booking link (the marketing button's fallback).
create or replace function mailer_email_designs(secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  return jsonb_build_object(
    'outreach', (select value from settings where key = 'email_design'),
    'marketing', (select value from settings where key = 'email_marketing'),
    'booking_url', (select value #>> '{}' from settings where key = 'booking_url'));
end $$;

create or replace function mailer_message_design(secret text, p_message uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  return (select coalesce(o.design, c.design, 'outreach') from outreach_messages o
          left join campaigns c on c.id = o.campaign_id where o.id = p_message);
end $$;

do $$
declare f text;
begin
  foreach f in array array['email_marketing()', 'set_email_marketing(jsonb)', 'team_update_email(uuid,text,text,text)',
                           'set_emails_design(uuid[],text)', 'mailer_email_designs(text)', 'mailer_message_design(text,uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  grant execute on function email_marketing() to authenticated;
  grant execute on function set_email_marketing(jsonb) to authenticated;
  grant execute on function team_update_email(uuid, text, text, text) to authenticated;
  grant execute on function set_emails_design(uuid[], text) to authenticated;
  grant execute on function mailer_email_designs(text) to anon, authenticated;
  grant execute on function mailer_message_design(text, uuid) to anon, authenticated;
end $$;
