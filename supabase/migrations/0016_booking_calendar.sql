-- 0016: booking calendars (like a GoHighLevel personal calendar) + Google Calendar. Re-runnable.
--   * calendars: one host each, weekly hours, length, interval, buffers, notice, window, daily cap.
--   * bookings: made on the public page (/book/<slug>) or by staff; a booking makes or joins a lead
--     (meeting_booked), gives the contact express consent, and adds a task, an activity and an Inbox item.
--   * calendar_accounts: each member's Google Calendar (encrypted refresh token, not readable through the API):
--     its busy times block slots, and bookings are added to it with a Google Meet link.
-- The public page talks to the database only through the server (MAILER_SECRET), like the website form.

create table if not exists calendars (
  id                 uuid primary key default gen_random_uuid(),
  host_member_id     uuid not null references team_members(id) on delete cascade,
  name               text not null check (length(trim(name)) between 1 and 120),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  description        text check (length(description) <= 2000),
  duration_min       int not null default 30 check (duration_min between 5 and 480),
  slot_interval_min  int not null default 30 check (slot_interval_min between 5 and 240),
  buffer_before_min  int not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min   int not null default 15 check (buffer_after_min between 0 and 240),
  min_notice_hours   int not null default 12 check (min_notice_hours between 0 and 720),
  max_days_ahead     int not null default 30 check (max_days_ahead between 1 and 365),
  max_per_day        int check (max_per_day between 1 and 50),
  timezone           text not null default 'America/New_York',
  availability       jsonb not null default '{"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}]}'::jsonb,
  location_type      text not null default 'google_meet' check (location_type in ('google_meet', 'phone', 'custom')),
  location_detail    text check (length(location_detail) <= 300),
  confirmation_note  text check (length(confirmation_note) <= 1000),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
drop trigger if exists calendars_updated_at on calendars;
create trigger calendars_updated_at before update on calendars for each row execute function set_updated_at();

create table if not exists bookings (
  id               uuid primary key default gen_random_uuid(),
  calendar_id      uuid not null references calendars(id) on delete cascade,
  host_member_id   uuid references team_members(id) on delete set null,
  company_id       uuid references companies(id) on delete set null,
  contact_id       uuid references contacts(id) on delete set null,
  name             text not null,
  email            text not null,
  phone            text,
  company_name     text,
  notes            text,
  start_at         timestamptz not null,
  end_at           timestamptz not null check (end_at > start_at),
  status           text not null default 'booked' check (status in ('booked', 'cancelled')),
  manage_token     text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  google_event_id  text,
  meet_url         text,
  source           text not null default 'booking_page' check (source in ('booking_page', 'staff')),
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now()
);
create index if not exists bookings_host_time_idx on bookings (host_member_id, start_at) where status = 'booked';
create index if not exists bookings_company_idx on bookings (company_id);

create table if not exists booking_hits (ip_hash text not null, at timestamptz not null default now());

create table if not exists calendar_accounts (
  member_id                uuid primary key references team_members(id) on delete cascade,
  email                    text not null,
  refresh_token_encrypted  text not null,
  check_conflicts          boolean not null default true,
  add_events               boolean not null default true,
  connected_at             timestamptz not null default now(),
  last_error               text,
  needs_reconnect          boolean not null default false
);

alter table calendars enable row level security;
alter table bookings enable row level security;
alter table booking_hits enable row level security;
alter table calendar_accounts enable row level security;
drop policy if exists team_select on calendars;
drop policy if exists team_insert on calendars;
drop policy if exists team_update on calendars;
drop policy if exists host_delete on calendars;
create policy team_select on calendars for select to authenticated using (is_team_member());
create policy team_insert on calendars for insert to authenticated with check (is_team_member());
create policy team_update on calendars for update to authenticated using (is_team_member()) with check (is_team_member());
create policy host_delete on calendars for delete to authenticated using (host_member_id = current_member_id() or is_team_owner());
drop policy if exists team_select on bookings;
create policy team_select on bookings for select to authenticated using (is_team_member());
grant select, insert, update, delete on calendars to authenticated;
grant select on bookings to authenticated;
revoke all on calendar_accounts, booking_hits from anon, authenticated;

-- ---------- a member's Google Calendar ----------
create or replace function save_my_calendar_account(p_email text, p_token_encrypted text) returns void
language plpgsql security definer set search_path = public as $$
declare m uuid := current_member_id();
begin
  if m is null then raise exception 'not a team member' using errcode = '42501'; end if;
  if coalesce(p_token_encrypted, '') !~ '^v1\.' then raise exception 'bad calendar token'; end if;
  insert into calendar_accounts (member_id, email, refresh_token_encrypted)
  values (m, lower(trim(p_email)), p_token_encrypted)
  on conflict (member_id) do update set email = excluded.email, refresh_token_encrypted = excluded.refresh_token_encrypted,
    connected_at = now(), last_error = null, needs_reconnect = false;
end $$;

create or replace function my_calendar_account() returns table (email text, check_conflicts boolean, add_events boolean, connected_at timestamptz, last_error text, needs_reconnect boolean)
language sql stable security definer set search_path = public as $$
  select email, check_conflicts, add_events, connected_at, last_error, needs_reconnect from calendar_accounts where member_id = current_member_id()
$$;

-- Who has a Google Calendar connected (for the Calendar page), without anything secret.
create or replace function team_calendar_accounts() returns table (member_id uuid, email text, needs_reconnect boolean)
language sql stable security definer set search_path = public as $$
  select member_id, email, needs_reconnect from calendar_accounts where is_team_member()
$$;

create or replace function set_my_calendar_options(p_check_conflicts boolean, p_add_events boolean) returns void
language sql security definer set search_path = public as $$
  update calendar_accounts set check_conflicts = coalesce(p_check_conflicts, check_conflicts), add_events = coalesce(p_add_events, add_events)
  where member_id = current_member_id()
$$;

create or replace function disconnect_my_calendar() returns void
language sql security definer set search_path = public as $$
  delete from calendar_accounts where member_id = current_member_id()
$$;

-- ---------- for the server (MAILER_SECRET): the public booking page ----------
create or replace function mailer_calendar_account(secret text, p_member uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  return (select jsonb_build_object('email', email, 'token', refresh_token_encrypted, 'check_conflicts', check_conflicts, 'add_events', add_events)
          from calendar_accounts where member_id = p_member and not needs_reconnect);
end $$;

create or replace function mailer_calendar_error(secret text, p_member uuid, p_error text, p_reconnect boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  update calendar_accounts set last_error = left(p_error, 500), needs_reconnect = needs_reconnect or coalesce(p_reconnect, false) where member_id = p_member;
end $$;

/** A calendar for its public page, with the host's bookings that block time. */
create or replace function mailer_booking_calendar(secret text, p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c calendars%rowtype;
begin
  perform mailer_check(secret);
  select * into c from calendars where slug = lower(p_slug) and active;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'host_member_id', c.host_member_id,
    'host_name', (select full_name from team_members where id = c.host_member_id),
    'duration_min', c.duration_min, 'slot_interval_min', c.slot_interval_min, 'buffer_before_min', c.buffer_before_min,
    'buffer_after_min', c.buffer_after_min, 'min_notice_hours', c.min_notice_hours, 'max_days_ahead', c.max_days_ahead,
    'max_per_day', c.max_per_day, 'timezone', c.timezone, 'availability', c.availability,
    'location_type', c.location_type, 'location_detail', c.location_detail, 'confirmation_note', c.confirmation_note,
    'busy', coalesce((select jsonb_agg(jsonb_build_object('start', b.start_at, 'end', b.end_at)) from bookings b
                      where b.host_member_id = c.host_member_id and b.status = 'booked'
                        and b.end_at > now() and b.start_at < now() + make_interval(days => c.max_days_ahead + 1)), '[]'::jsonb),
    'booked', coalesce((select jsonb_agg(jsonb_build_object('start', b.start_at, 'end', b.end_at)) from bookings b
                        where b.calendar_id = c.id and b.status = 'booked' and b.end_at > now() - interval '1 day'), '[]'::jsonb));
end $$;

/** Save a booking made on the public page (the server has already checked the time is free). */
create or replace function mailer_booking_create(secret text, p_calendar uuid, p_start timestamptz, p_name text, p_email text,
                                                 p_phone text, p_company text, p_notes text, p_page text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c      calendars%rowtype;
  addr   text := lower(trim(p_email));
  stop   timestamptz;
  co_id  uuid;
  ct_id  uuid;
  bk     bookings%rowtype;
  is_new boolean := false;
  body   text;
begin
  perform mailer_check(secret);
  select * into c from calendars where id = p_calendar and active for update;   -- one booking at a time per calendar
  if not found then raise exception 'this calendar is closed'; end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(addr) > 200 then raise exception 'enter a valid email address'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'enter your name'; end if;
  if p_start < now() then raise exception 'that time has passed'; end if;

  delete from booking_hits where at < now() - interval '2 days';
  if (select count(*) from booking_hits where ip_hash = coalesce(p_ip_hash, '') and at > now() - interval '1 hour') >= 5
     or (select count(*) from booking_hits where at > now() - interval '1 day') >= 200 then
    raise exception 'too many bookings, try again later' using errcode = '54000';
  end if;
  insert into booking_hits (ip_hash) values (coalesce(p_ip_hash, ''));

  stop := p_start + make_interval(mins => c.duration_min);
  perform pg_advisory_xact_lock(hashtext('booking:' || c.host_member_id::text));   -- across all of the host's calendars
  if exists (select 1 from bookings b where b.host_member_id = c.host_member_id and b.status = 'booked'
             -- Both meetings keep their buffers: the gap must cover one's "after" plus the other's "before".
             and b.start_at - make_interval(mins => c.buffer_before_min) < stop + make_interval(mins => c.buffer_after_min)
             and b.end_at + make_interval(mins => c.buffer_after_min) > p_start - make_interval(mins => c.buffer_before_min)) then
    raise exception 'that time was just taken' using errcode = '23P01';
  end if;

  -- Someone we know? Otherwise a new lead.
  select ct.company_id, ct.id into co_id, ct_id from contacts ct where lower(ct.email) = addr order by ct.created_at limit 1;
  if co_id is null then
    insert into companies (name, source, stage, owner_id)
    values (left(coalesce(nullif(trim(p_company), ''), trim(p_name)), 200), 'booking', 'meeting_booked', c.host_member_id)
    returning id into co_id;
    is_new := true;
  else
    update companies set stage = 'meeting_booked'
    where id = co_id and crm_stage_rank(stage) < crm_stage_rank('meeting_booked') and stage not in ('won', 'lost', 'disqualified');
  end if;
  if ct_id is null then
    insert into contacts (company_id, full_name, email, phone, consent_basis, source_url)
    values (co_id, left(trim(p_name), 200), addr, nullif(left(trim(p_phone), 40), ''), 'express', left(p_page, 500))
    on conflict (company_id, lower(email)) where email is not null do update set full_name = coalesce(contacts.full_name, excluded.full_name)
    returning id into ct_id;
  else
    update contacts set consent_basis = 'express', phone = coalesce(phone, nullif(left(trim(p_phone), 40), '')) where id = ct_id;
  end if;

  insert into bookings (calendar_id, host_member_id, company_id, contact_id, name, email, phone, company_name, notes, start_at, end_at)
  values (c.id, c.host_member_id, co_id, ct_id, left(trim(p_name), 200), addr, nullif(left(trim(p_phone), 40), ''),
          nullif(left(trim(p_company), 200), ''), nullif(left(trim(p_notes), 2000), ''), p_start, stop)
  returning * into bk;

  body := concat_ws(E'\n', 'Meeting booked: ' || c.name, 'With: ' || trim(p_name) || ' <' || addr || '>',
    case when nullif(trim(p_phone), '') is not null then 'Phone: ' || left(trim(p_phone), 40) end,
    case when nullif(trim(p_company), '') is not null then 'Company: ' || left(trim(p_company), 200) end,
    'When: ' || to_char(p_start at time zone c.timezone, 'Dy DD Mon YYYY HH24:MI') || ' (' || c.timezone || ')',
    case when nullif(trim(p_notes), '') is not null then 'Notes: ' || left(trim(p_notes), 2000) end);
  insert into notes (company_id, member_id, body, pinned) values (co_id, null, body, true);
  insert into tasks (company_id, title, due_at, assignee_id, created_by, source)
  values (co_id, left('Meeting with ' || trim(p_name) || ' (' || c.name || ')', 300), p_start, c.host_member_id, null, 'system');
  insert into inbound_messages (gmail_message_id, company_id, contact_id, from_email, subject, snippet, body_text,
                                received_at, classification, classified_by, handled)
  values ('booking:' || bk.id, co_id, ct_id, addr, 'Meeting booked: ' || c.name, left(body, 300), body, now(), 'meeting_request', 'system', false);
  insert into activities (company_id, type, payload, actor)
  values (co_id, 'meeting_booked', jsonb_build_object('booking_id', bk.id, 'calendar', c.name, 'start', p_start, 'new_lead', is_new), 'system');

  return jsonb_build_object('id', bk.id, 'token', bk.manage_token, 'company_id', co_id, 'start', bk.start_at, 'end', bk.end_at, 'new_lead', is_new);
end $$;

create or replace function mailer_booking_event(secret text, p_booking uuid, p_event_id text, p_meet_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  update bookings set google_event_id = left(p_event_id, 300), meet_url = left(p_meet_url, 500) where id = p_booking;
end $$;

create or replace function mailer_booking_by_token(secret text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  return (select jsonb_build_object('id', b.id, 'name', b.name, 'email', b.email, 'start', b.start_at, 'end', b.end_at, 'status', b.status,
            'meet_url', b.meet_url, 'calendar', c.name, 'slug', c.slug, 'timezone', c.timezone, 'location_type', c.location_type,
            'location_detail', c.location_detail, 'host_name', (select full_name from team_members where id = b.host_member_id))
          from bookings b join calendars c on c.id = b.calendar_id where b.manage_token = p_token);
end $$;

/** Cancel a booking: by its link (public) or by staff (cancel_booking). Returns what the Google event needs. */
create or replace function booking_do_cancel(p_id uuid, p_reason text, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bk bookings%rowtype;
begin
  update bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = left(nullif(trim(p_reason), ''), 500)
  where id = p_id and status = 'booked' and end_at > now() returning * into bk;
  if not found then raise exception 'this booking can''t be cancelled (already cancelled or in the past)'; end if;
  update tasks set done_at = now() where company_id = bk.company_id and done_at is null and source = 'system'
    and title like 'Meeting with %' and due_at = bk.start_at;
  insert into activities (company_id, type, payload, actor)
  values (bk.company_id, 'meeting_cancelled', jsonb_build_object('booking_id', bk.id, 'by', p_by, 'reason', bk.cancel_reason), 'system');
  if p_by = 'contact' then
    insert into inbound_messages (gmail_message_id, company_id, contact_id, from_email, subject, snippet, body_text, received_at, classification, classified_by, handled)
    values ('booking-cancel:' || bk.id, bk.company_id, bk.contact_id, bk.email, 'Meeting cancelled',
            left(coalesce(bk.cancel_reason, 'They cancelled their meeting.'), 300),
            'Meeting on ' || to_char(bk.start_at, 'YYYY-MM-DD HH24:MI') || ' UTC was cancelled by ' || bk.name || '. ' || coalesce('Reason: ' || bk.cancel_reason, ''),
            now(), 'not_now', 'system', false);
  end if;
  return jsonb_build_object('host_member_id', bk.host_member_id, 'google_event_id', bk.google_event_id);
end $$;
revoke execute on function booking_do_cancel(uuid, text, text) from public, anon, authenticated;

create or replace function mailer_booking_cancel(secret text, p_token text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  perform mailer_check(secret);
  select id into bid from bookings where manage_token = p_token;
  if bid is null then raise exception 'booking not found'; end if;
  return booking_do_cancel(bid, p_reason, 'contact');
end $$;

create or replace function cancel_booking(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_member() then raise exception 'not a team member' using errcode = '42501'; end if;
  return booking_do_cancel(p_id, p_reason, 'team');
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'save_my_calendar_account(text,text)', 'my_calendar_account()', 'team_calendar_accounts()', 'set_my_calendar_options(boolean,boolean)',
    'disconnect_my_calendar()', 'cancel_booking(uuid,text)',
    'mailer_calendar_account(text,uuid)', 'mailer_calendar_error(text,uuid,text,boolean)', 'mailer_booking_calendar(text,text)',
    'mailer_booking_create(text,uuid,timestamptz,text,text,text,text,text,text,text)', 'mailer_booking_event(text,uuid,text,text)',
    'mailer_booking_by_token(text,text)', 'mailer_booking_cancel(text,text,text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if f like 'mailer_%' then execute format('grant execute on function %s to anon, authenticated', f);
    else execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;
