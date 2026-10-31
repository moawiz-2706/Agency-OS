-- AgencyOS 0005 — new sign-ins wait for the owner's approval
-- Anyone who signs in for the first time (Google, email link) gets a pending
-- team_members row (active = false). RLS already hides every table from inactive
-- members, so they see nothing until the owner sets active = true in Supabase
-- (Table Editor -> team_members). People already listed (by email) are linked
-- to their login and keep their status. Safe to re-run.

-- ---------- new auth user -> pending team member ----------
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null then return new; end if;
  insert into team_members (user_id, email, full_name, role, active)
  values (
    new.id,
    lower(new.email),
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    'partner',
    false                                   -- pending until the owner approves
  )
  on conflict ((lower(email))) do update
    set user_id   = coalesce(team_members.user_id, excluded.user_id),
        full_name = coalesce(team_members.full_name, excluded.full_name);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------- what the app shows the signed-in user ----------
-- 'active' (full CRM), 'pending' (waiting for approval) or null (not on the team at all).
create or replace function my_member_status() returns text
language sql stable security definer set search_path = public as $$
  select case when active then 'active' else 'pending' end
  from team_members
  where user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by active desc
  limit 1
$$;
grant execute on function my_member_status() to authenticated;

-- Sign-ins from before this migration that have no team row yet: add them as pending.
insert into team_members (user_id, email, role, active)
select u.id, lower(u.email), 'partner', false
from auth.users u
where u.email is not null
  and not exists (select 1 from team_members t where t.user_id = u.id or lower(t.email) = lower(u.email))
on conflict ((lower(email))) do nothing;
