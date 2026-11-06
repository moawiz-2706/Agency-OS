-- 0014: how outreach emails look (the Templates page). Re-runnable.
-- One team-wide design in settings('email_design'): style personal | branded | plain,
-- accent colour, sign-off, font. The worker reads it at send time, so emails already
-- waiting go out in the current design too. Plain = the old text-only email.

insert into settings (key, value)
values ('email_design', '{"style":"personal","accent":"#1d4ed8","sign_off":"Best regards,","font":"sans"}'::jsonb)
on conflict (key) do nothing;

create or replace function email_design() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_team_member() then (select value from settings where key = 'email_design') end
$$;

create or replace function set_email_design(p_design jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_style text := coalesce(p_design->>'style', 'personal');
  v_accent text := coalesce(p_design->>'accent', '#1d4ed8');
  v_sign text := btrim(regexp_replace(coalesce(p_design->>'sign_off', ''), '[\r\n]+', ' ', 'g'));
  v_font text := coalesce(p_design->>'font', 'sans');
begin
  if not is_team_owner() then raise exception 'only an owner can change the email design' using errcode = '42501'; end if;
  if v_style not in ('personal', 'branded', 'plain') then raise exception 'unknown email style: %', v_style; end if;
  if v_accent !~ '^#[0-9a-fA-F]{6}$' then raise exception 'the accent colour must look like #1d4ed8'; end if;
  if length(v_sign) > 60 then raise exception 'keep the sign-off under 60 characters'; end if;
  if v_font not in ('sans', 'serif') then raise exception 'unknown font: %', v_font; end if;
  insert into settings (key, value)
  values ('email_design', jsonb_build_object('style', v_style, 'accent', lower(v_accent), 'sign_off', v_sign, 'font', v_font))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- For the mail worker (MAILER_SECRET, no user session).
create or replace function mailer_email_design(secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform mailer_check(secret);
  return (select value from settings where key = 'email_design');
end $$;

do $$
declare f text;
begin
  foreach f in array array['email_design()', 'set_email_design(jsonb)', 'mailer_email_design(text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  grant execute on function email_design() to authenticated;
  grant execute on function set_email_design(jsonb) to authenticated;
  grant execute on function mailer_email_design(text) to anon, authenticated;
end $$;
