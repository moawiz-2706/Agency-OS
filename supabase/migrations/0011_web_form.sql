-- 0011: enquiries from the website's contact form become leads.
-- Run once in Supabase -> SQL Editor (safe to run again).
--
-- The website posts to the app (/api/forms/contact); the app checks the spam guards and
-- calls web_form_submit with the worker secret, so the database is never open to the
-- public. A known email or website joins its existing lead; otherwise a new lead is
-- created at stage "interested". Each enquiry is a note on the lead and an item to
-- handle on the Inbox page. At most 5 enquiries per visitor (IP hash) per hour and
-- 200 a day in total.

create table if not exists web_form_hits (
  id       bigserial primary key,
  ip_hash  text not null,
  at       timestamptz not null default now()
);
create index if not exists web_form_hits_idx on web_form_hits (ip_hash, at desc);
alter table web_form_hits enable row level security;   -- no policies: only the function below

create or replace function web_form_submit(secret text, p_name text, p_email text, p_company text, p_website text,
                                           p_tools text, p_pain text, p_page text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  addr   text := lower(trim(p_email));
  domain text := nullif(lower(regexp_replace(regexp_replace(coalesce(trim(p_website), ''), '^https?://(www\.)?', '', 'i'), '[/?#].*$', '')), '');
  co_id  uuid;
  ct_id  uuid;
  is_new boolean := false;
  body   text;
begin
  perform mailer_check(secret);
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(addr) > 200 then raise exception 'enter a valid email address'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'enter your name'; end if;

  -- Spam guard: per visitor and in total.
  delete from web_form_hits where at < now() - interval '2 days';
  if (select count(*) from web_form_hits where ip_hash = coalesce(p_ip_hash, '') and at > now() - interval '1 hour') >= 5
     or (select count(*) from web_form_hits where at > now() - interval '1 day') >= 200 then
    raise exception 'too many enquiries, try again later' using errcode = '54000';
  end if;
  insert into web_form_hits (ip_hash) values (coalesce(p_ip_hash, ''));

  -- Someone we know (by email, then by website)? Otherwise a new lead.
  select c.company_id, c.id into co_id, ct_id from contacts c where lower(c.email) = addr order by c.created_at limit 1;
  if co_id is null and domain is not null then
    select id into co_id from companies where lower(website_domain) = domain order by created_at limit 1;
  end if;
  if co_id is null then
    insert into companies (name, source, website, website_domain, stage)
    values (left(coalesce(nullif(trim(p_company), ''), trim(p_name)), 200), 'web_form',
            nullif(left(trim(p_website), 300), ''), domain, 'interested')
    returning id into co_id;
    is_new := true;
  else
    -- An enquiry is a strong signal: lift the lead to "interested" unless it's further along.
    update companies set stage = 'interested'
    where id = co_id and crm_stage_rank(stage) < crm_stage_rank('interested') and stage not in ('won', 'lost', 'disqualified');
  end if;
  if ct_id is null then
    insert into contacts (company_id, full_name, email, consent_basis, source_url)
    values (co_id, left(trim(p_name), 200), addr, 'express', left(p_page, 500))
    on conflict (company_id, lower(email)) where email is not null do update set full_name = coalesce(contacts.full_name, excluded.full_name)
    returning id into ct_id;
  else
    -- They asked us to get in touch: that's express consent (and CASL-safe).
    update contacts set consent_basis = 'express' where id = ct_id and consent_basis <> 'express';
  end if;

  body := concat_ws(E'\n',
    'Website enquiry from ' || trim(p_name) || ' <' || addr || '>',
    case when nullif(trim(p_company), '') is not null then 'Company: ' || left(trim(p_company), 200) end,
    case when nullif(trim(p_website), '') is not null then 'Website: ' || left(trim(p_website), 300) end,
    case when nullif(trim(p_tools), '') is not null then 'Tools they use: ' || left(trim(p_tools), 1000) end,
    case when nullif(trim(p_pain), '') is not null then 'Biggest time-waster: ' || left(trim(p_pain), 3000) end,
    case when nullif(trim(p_page), '') is not null then 'Sent from: ' || left(p_page, 300) end);
  insert into notes (company_id, member_id, body, pinned) values (co_id, null, body, true);
  insert into inbound_messages (gmail_message_id, company_id, contact_id, from_email, subject, snippet, body_text,
                                received_at, classification, classified_by, handled)
  values ('form:' || gen_random_uuid(), co_id, ct_id, addr, 'Website enquiry', left(coalesce(nullif(trim(p_pain), ''), body), 300),
          body, now(), 'question', 'system', false);
  insert into activities (company_id, type, payload, actor)
  values (co_id, 'web_form', jsonb_build_object('email', addr, 'new_lead', is_new), 'system');
  return jsonb_build_object('company_id', co_id, 'new_lead', is_new);
end $$;

revoke execute on function web_form_submit(text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function web_form_submit(text,text,text,text,text,text,text,text,text) to anon, authenticated;
