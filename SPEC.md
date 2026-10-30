# AgencyOS — In-House System Spec

Oct 31, 2026 · @moawiz

> Supersedes the v0.1 lead-discovery spec, kept at `docs/SPEC-v0.1.md` (it holds the v0.1 scoring
> rules this spec refers to).

## Overview

AgencyOS is the in-house system that takes a US or Canadian home-service business from "found on
Google" to "paying client". It runs on Claude Pro, your own MCP server, Supabase and your business
email, with no other SaaS subscriptions in Phase 1.

**Business it serves:** a GHL automation agency selling the "Never miss a lead" offer to home-service
businesses: missed-call text-back, instant lead reply, online booking, review automation and a simple
pipeline.

### Design principles

- **Own the data.** Supabase is the single source of truth. Claude, the dashboard and later workers
  all read and write the same tables.
- **Claude decides, the server enforces.** Claude chooses tools and writes text. The server validates
  input, checks suppression and approval rules, and logs every action.
- **Cheap work in code, thinking in Claude.** Fetching, parsing, dedupe and scoring run server-side.
  Claude gets compact summaries, which keeps Pro usage low.
- **Human approval on anything that leaves the building.** Emails, proposals and prices need your
  approval until the system has earned trust.
- **Built to extend.** New lead sources, AI providers, channels and workers plug in behind interfaces.
  Nothing in Phase 1 needs a rewrite later.

### Phase 1 success criteria

| Measure | Target |
|---|---|
| Leads saved and scored | 300+ across 3 cities |
| Leads researched (full report) | 60+ |
| Approved emails sent | 150+ over 4 weeks, from a warmed outreach domain |
| Positive replies | 5+ |
| Discovery calls booked | 3+ |
| Paying clients | 1–2 |

These targets are starting guesses. Adjust them after the first two weeks of real sending.

## Phases

Phase 1 covers everything needed to win the first clients: find, research, contact, follow up, book
and track. Phases 2 and 3 add automation and delivery only after real buyers show up.

| Phase | What it adds | Move on when |
|---|---|---|
| 1 — Acquire (now) | Lead discovery, website audit, scoring, AI research reports, contacts, outreach drafts with approval, Gmail sending, reply sync, inbox, pipeline, booking link, basic analytics, minimal dashboard | First paying client, and outreach steady at 20–30 emails/day with positive replies |
| 2 — Close and automate | Proposals, Stripe or Payoneer invoices, client onboarding, scheduled jobs (worker), Claude API for unattended research, follow-up sequences on autopilot, reply auto-classification | 3+ clients, or manual work over 10 hours/week |
| 3 — Deliver and scale | Projects and tasks, client portal, GHL sub-account provisioning via API, retainers and health reports, more channels (SMS, LinkedIn), multi-user roles, optional SaaS for other agencies | Recurring revenue covers costs and delivery is the bottleneck |

**Already built (v0.1):** Supabase schema for companies, contacts, searches, audits, activities and
suppressions, plus an MCP server with 9 tools for Google Places search, website audit, scoring and
lead management. Phase 1 builds on that repo.

## Architecture

Claude Pro, the dashboard and the Phase 2 worker are three doors into one `core` package. Only core
touches Supabase and outside services, so the rules are enforced in one place.

| Component | Responsible for | Never does |
|---|---|---|
| Claude Desktop (Pro) | Picking tools, writing research, emails and reply drafts, explaining results | Holding keys or touching the database directly |
| MCP server | Exposing core functions as tools over stdio on your PC | Business logic |
| Dashboard | Review, approvals, inbox, pipeline, settings, public /book and /unsubscribe | Sending without an approved record |
| core | Validation, scoring, consent and suppression checks, state changes, activity log | Calling a vendor except through an adapter |
| Supabase | All data, auth, backups | Anything exposed to the browser without RLS |
| Adapters | Google Places, website fetch, Gmail, Calendar; later Claude API, Stripe, GHL | Deciding anything |

## Phase 1 modules and features

Ten modules, in pipeline order. Each lists what it must do now and the hook it leaves for later.

### 1. Lead discovery

- Search Google Places (New) Text Search by niche preset and city. Up to 60 results per search, paged
  in 20s.
- Niche presets: HVAC, roofing, plumbing, electrical, cleaning, landscaping, pest control, garage
  door. Free-text niches are allowed too.
- Dedupe on `google_place_id`, then on `website_domain`, then on normalized phone.
- CSV import of purchased or exported lists, mapped to the same fields and deduped the same way.
- Every search is logged in `search_runs` with found and new counts, so you can see which city and
  niche pairs pay off.
- Daily cap on Google requests, set in config, so the tools refuse once it's hit.
- *Later:* more sources plug in behind a `LeadSource` adapter (Yelp Fusion, state licence boards, BBB,
  purchased data).

### 2. Website audit

- Fetch the homepage plus up to 3 key pages (contact, services, about), with robots.txt respected and
  SSRF guards in place.
- Detect: online booking tool, chat widget, "text us" link, review widget, ad pixels (Meta, Google
  Ads, TikTok, Bing), GHL/LeadConnector, field-service platforms (ServiceTitan, Housecall Pro,
  Jobber), mobile viewport, HTTPS.
- Extract published emails and phone numbers, with the page URL each was found on.
- Store a condensed text extract (max ~4,000 characters) for the research step, not the raw HTML.
- *Later:* page-speed score, Google Business Profile checks, a mystery-shopper form submission to time
  their reply.

### 3. Scoring and qualification

- Rule-based 0–100 score with stored reasons (the v0.1 rules). Tiers: 70+ high, 50–69 medium, under
  50 low.
- Auto-status only moves between `new`, `review` and `qualified`. Later stages are always set by you.
- Weights live in a `scoring_rules` config so they can be tuned without code changes.
- *Later:* a weekly report comparing score against reply rate, to re-weight the rules.

### 4. AI research report

- Claude reads the audit extract and signals, then writes a structured report through
  `save_research_report`.
- The report separates **observed** (seen on the site), **inferred** (likely, needs confirming) and
  **unknown**.
- Required fields: business summary, services, service area, top 3 gaps with evidence URLs,
  recommended package from the service catalog, 3–5 discovery questions, one personalization hook for
  the email, confidence 0–1.
- The server validates the report with a Zod schema and rejects any gap that has no evidence URL.
- *Later:* the same schema is filled by the Claude API worker for unattended research.

### 5. Contacts

- Contacts per company: name, role, email, phone, `source_url`, `email_published_publicly`,
  `consent_basis`, `verified_at`.
- Owner-name capture from the about page or Google listing, entered by Claude with its source.
- Email check before sending: syntax, MX record, and not on the suppression list. Role addresses like
  info@ are allowed but flagged.
- Country rule: Canadian contacts can't be sent to unless `consent_basis` is a CASL basis.
- *Later:* an enrichment adapter (Hunter, Apollo) behind a `ContactFinder` interface.

### 6. Outreach

- Templates for each step of a 4-touch sequence (day 1, 4, 8, 14), with merge fields and one
  AI-written personal line.
- Claude drafts with `draft_outreach`, and the drafts land in an approval queue. Nothing sends without
  approval.
- Approve, edit or reject in the dashboard or through Claude (`approve_outreach`).
- The send queue respects: per-inbox daily limit (start 20, ramp to 30–40), business hours in the
  lead's time zone, a random 2–6 minute gap, and suppression and consent checks at send time.
- Every email carries your physical address, a plain-text opt-out line, and an unsubscribe link that
  adds the address to suppressions.
- Follow-ups stop automatically on any reply, bounce or opt-out.
- *Later:* A/B testing of subject lines and a Loom-video step.

### 7. Email sending and inbox sync

- Gmail API through OAuth 2.0 on a Google Workspace mailbox on a separate outreach domain. Refresh
  tokens are stored encrypted.
- Send via `users.messages.send`, keeping `threadId` and `Message-ID` so replies thread correctly.
- Reply sync: poll `users.history.list` every few minutes while the worker runs (Phase 1 can be a
  manual `sync_inbox` tool), then match replies to leads by thread ID, falling back to sender email.
- Bounce detection from mailer-daemon messages, which marks the contact bounced and suppresses it.
- *Later:* Microsoft Graph adapter, multiple inboxes in rotation, Gmail push notifications via Pub/Sub.

### 8. Inbox and replies

- Unified inbox of all prospect threads, newest first, with the lead's score and research one click
  away.
- Claude classifies each reply: interested, question, pricing, meeting request, not now, not
  interested, unsubscribe, out of office, bounce.
- Auto-actions: unsubscribe and not interested stop the sequence; interested and meeting request move
  the lead to `interested` and draft a reply with the booking link.
- Every reply you send needs approval in Phase 1.

### 9. Pipeline and booking

- Kanban by status, from `qualified` to `won` or `lost`. Dragging a card logs the change.
- Deals: package, setup fee, monthly fee, expected close date, probability.
- Booking: a public `/book` page on your app showing free slots from Google Calendar (free/busy).
  Booking creates a calendar event with a Meet link, a confirmation email, and an `appointments` row.
  Reminders go out 24 hours and 1 hour before.
- Call prep: `prepare_call_brief` assembles research, the email thread and discovery questions.
- After the call, notes and outcome are saved, and the lead moves to `proposal_sent`, `won` or `lost`.

### 10. Analytics

- Funnel: found → qualified → researched → contacted → replied → positive → booked → won.
- Rates by niche, city, template and score tier.
- Deliverability: sent, bounced and unsubscribed per day and per inbox, with an alert if bounces go
  over 3% in a day.
- Google API spend estimate per month from request counts.

## Data model

Phase 1 needs 20 tables in Supabase Postgres. Six already exist in v0.1 (marked ✓). Every table has
`id uuid`, `created_at` and `updated_at`, and RLS is on.

| Table | Holds | Key columns and rules |
|---|---|---|
| companies ✓ | One business | `google_place_id` unique, `website_domain`, phone, niche, city/region/country, rating, review_count, status, score, tier, score_breakdown, timezone, owner_id |
| contacts ✓ | People at a company | unique (company, lower(email)); source_url, consent_basis, email_status (unknown/valid/risky/bounced), do_not_contact |
| search_runs ✓ | Each discovery search | source, query, city, found, new, cost estimate |
| website_audits ✓ | Each site check | signals jsonb, text_extract, pages fetched, error |
| research_reports | AI report per company | summary, observed jsonb, inferred jsonb, gaps jsonb (each with evidence URL), recommended_service_id, discovery_questions, hook, confidence, model, version |
| services | Your catalog | name, description, setup price range, monthly price range, deliverables, active |
| templates | Email templates | step (1–4), subject, body with `{{merge}}` fields, niche, active, variant |
| campaigns | A sequence run | niche, cities, template set, daily limit, sending inbox, status (draft/active/paused) |
| campaign_members | Lead in a campaign | unique (campaign, contact); current_step, next_send_at, stopped_reason |
| outreach_messages | Every outbound email | status (draft/pending_approval/approved/queued/sent/failed/cancelled), subject, body, approved_by, approved_at, gmail_message_id, thread_id, sent_at, idempotency_key unique |
| email_threads | One Gmail thread | thread_id unique, company, contact, last message at, unread |
| inbound_messages | Every reply | gmail_message_id unique, from, snippet, body text, classification, classified_by |
| mail_accounts | Connected inboxes | email, provider, encrypted refresh token, daily limit, warmup stage, sent_today |
| suppressions ✓ | Never contact | unique lower(email) or lower(domain), reason |
| deals | Sales opportunity | company, service, setup fee, monthly fee, stage, probability, expected close |
| appointments | Discovery calls | start/end, calendar_event_id, meet link, status (booked/held/no_show/cancelled), notes, outcome |
| approvals | Generic approval queue | entity_type, entity_id, action, requested_by (claude/user), status, decided_at |
| activities ✓ | Audit trail | company, actor (claude/user/system), type, payload |
| jobs | Background work | type, payload, status (pending/running/done/failed), attempts, run_after, locked_at, last error |
| settings | Key-value config | daily caps, sending hours, business address, scoring weights |

**Lead status:** new → review / qualified → researched → ready_for_outreach → in_sequence → replied →
interested → meeting_booked → proposal_sent → won / lost. `disqualified` and `do_not_contact` can be
set from any stage. Add `researched` and `in_sequence` to the v0.1 enum in the next migration.

### Integrity rules

- `outreach_messages.idempotency_key` = campaign + contact + step, so a retry never sends twice.
- A database trigger blocks moving a message to `queued` if the contact is suppressed or
  `do_not_contact`.
- Money is stored as integer cents with a currency column (USD or CAD).
- Migrations live in `supabase/migrations`, numbered and never edited after they run.

## MCP tool catalog

The Phase 1 server exposes 33 tools: 9 exist in v0.1 (✓), and 24 are new. Tools return compact JSON
(IDs, names, scores, short findings), never raw HTML or full email bodies unless asked.

**Approval levels:** *Auto* runs at once. *Queued* creates a record that waits for your approval.
*Confirm* means Claude must ask you in chat first; the tool also requires `confirm: true`.

| Area | Tool | Does | Level |
|---|---|---|---|
| Discovery | `list_niches_and_markets` ✓ | Presets and starter cities | Auto |
| Discovery | `find_leads` ✓ | Places search, dedupe, save, first score | Auto (daily cap) |
| Discovery | `import_leads_csv` | Map and import a CSV, deduped | Auto |
| Audit | `audit_websites` ✓ | Multi-page check, signals, extract, re-score | Auto |
| Research | `get_research_input` | Audit extract + signals + services catalog for one lead | Auto |
| Research | `save_research_report` | Validate and store Claude's report | Auto |
| Research | `list_research_queue` | Qualified leads with no report yet | Auto |
| Leads | `list_leads` ✓ | Filtered lead list | Auto |
| Leads | `get_lead` ✓ | Full record + report + contacts + history | Auto |
| Leads | `update_lead` ✓ | Status and notes | Auto |
| Contacts | `add_contact` ✓ | Save with source and consent basis | Auto |
| Contacts | `verify_email` | Syntax, MX and suppression check | Auto |
| Contacts | `suppress` ✓ | Never-contact list | Auto |
| Outreach | `list_templates` / `save_template` | Read and edit templates | Auto |
| Outreach | `create_campaign` | Niche, cities, templates, limits | Queued |
| Outreach | `add_to_campaign` | Enrol eligible contacts (consent + suppression checked) | Auto |
| Outreach | `draft_outreach` | Write step N for a contact with a personal line | Queued |
| Outreach | `list_pending_approvals` | Everything waiting on you | Auto |
| Outreach | `approve_outreach` | Approve, edit or reject drafts | Confirm |
| Outreach | `pause_campaign` | Stop a campaign now | Auto |
| Email | `send_queue_run` | Send approved, due messages within limits | Confirm |
| Email | `sync_inbox` | Pull new replies and bounces, thread them | Auto |
| Inbox | `list_replies` | Unhandled replies with lead context | Auto |
| Inbox | `classify_reply` | Store Claude's classification and apply auto-actions | Auto |
| Inbox | `draft_reply` | Reply draft in the thread | Queued |
| Sales | `get_free_slots` / `book_meeting` | Calendar free/busy and booking | Confirm |
| Sales | `prepare_call_brief` | Research + thread + questions in one view | Auto |
| Sales | `upsert_deal` / `log_call_outcome` | Deal values, call notes, next stage | Auto |
| Reports | `pipeline_summary` ✓ / `funnel_report` | Counts, rates by niche, city, template | Auto |

**Rules every tool follows:** Zod-validated input; it writes an `activities` row with actor `claude`;
errors come back as `isError` with a plain message; and any batch call is capped (25 leads, 50 drafts,
40 sends).

## Dashboard screens

A small Next.js app on the same Supabase project, for the jobs that are faster with a mouse than
through chat: reviewing, approving and dragging cards. Claude stays the main way to run work. Seven
screens are enough for Phase 1.

| Screen | Shows | You do |
|---|---|---|
| Today | Pending approvals, unhandled replies, today's calls, sends left today, bounce rate, funnel for the last 7 days | Clear the queue each morning |
| Leads | Table with filters (niche, city, tier, status, score, audited, researched) and bulk select | Disqualify, add to campaign, open a lead |
| Lead detail | Company card, score reasons, audit signals, research report, contacts, full email thread, activity timeline | Edit contacts, change status, add notes |
| Approvals | Draft emails side by side with the research hook and evidence | Approve, edit or reject (keyboard shortcuts A / E / R) |
| Inbox | Threads with classification badges and the lead's tier | Read, approve Claude's reply draft, mark handled |
| Pipeline | Kanban from qualified to won/lost, with deal values in USD/CAD | Drag stages, open the call brief |
| Settings | Connected inbox, daily limits, sending hours, business address, templates, services catalog, scoring weights, Google API cap | Configure once, tune weekly |

**Public pages:** `/book` (booking calendar) and `/unsubscribe?t=<token>` (one-click opt-out, no
login).

**Access:** Supabase Auth with email magic link, limited to your own email in Phase 1. Server
components use the service key; nothing secret goes to the browser.

## Outreach, deliverability and compliance

The server enforces these rules in code, not as advice. A send that breaks one is blocked and logged.
This is not legal advice; check the CASL and CAN-SPAM rules yourself before the first send.

### Deliverability setup (before any send)

1. Buy a lookalike outreach domain (e.g. getyouragency.com) and a Google Workspace mailbox on it.
   Never send cold email from your main domain.
2. Set SPF, DKIM and DMARC (`p=none` to start) on the outreach domain. Point the root domain to your
   main site.
3. Warm up for 2–3 weeks: start at 5 emails/day to people who will reply, then ramp toward 20–30/day
   per inbox.
4. Plain-text emails, at most one link (the booking page), no images or attachments, no tracking pixel
   in Phase 1.
5. Pause automatically if bounces go over 3% or spam complaints show up.

### United States (CAN-SPAM)

- Cold B2B email is allowed.
- Honest From name and subject line; no fake "Re:" or "Fwd:".
- Your valid physical postal address in every email.
- A clear opt-out that works for at least 30 days, honoured within 10 business days. AgencyOS honours
  it at once.

### Canada (CASL)

- Send only when a CASL basis is recorded. For cold email that means implied consent: the address is
  conspicuously published (for example on the company's own website), there's no statement that they
  don't want unsolicited email, and the message is relevant to their business role.
- Store the `source_url` and the date found as proof. A contact with `consent_basis = unknown` can't
  be sent to.
- Identify yourself (name, business, mailing address, and email or phone) and include an unsubscribe
  that works for 60 days and is honoured within 10 business days.
- CASL penalties are much higher than CAN-SPAM's, so when in doubt, skip the lead.

### Content rules for Claude's drafts

- Mention only facts from the research report's observed section. Never claim you called them unless
  you actually did.
- No invented numbers, results or client names. Case studies only once you have real ones.
- Under 120 words, one question, one call to action.

### Data and privacy

- Store business contact data only. Delete a contact's data on request and keep only the suppression
  entry.
- Google Places data: keep the place ID permanently. Refresh other Google fields regularly and read
  the current Maps Platform terms before scaling.

## Security, reliability and operations

### Secrets

- Keys live only in `.env` on your machine and in the host's secret store once deployed: Supabase
  service key, Google Places key, Google OAuth client secret, and the token encryption key.
- Gmail refresh tokens are encrypted with AES-256-GCM before storage. The key never sits in the
  database.
- The Google Places key is restricted to Places API (New), with a daily quota and a budget alert set.
- Gmail OAuth asks only for `gmail.send`, `gmail.readonly` and `calendar.events`; nothing broader.

### Access

- RLS is on for every table. In Phase 1 only the service role reads and writes. Dashboard users get
  policies scoped to `owner_id` when a second user is added.
- The MCP server runs locally over stdio, so nothing is exposed to the internet. When it moves to a
  remote connector, it needs OAuth and HTTPS.

### Safety rails

- SSRF guard on every outbound fetch: public IPs only, ports 80/443, 4 redirects max, 1.5 MB cap, 10 s
  timeout.
- Hard caps in settings: Google requests/day, sends/day/inbox, drafts per call. Tools refuse past a
  cap.
- Kill switch: a `sending_enabled` setting stops all sends immediately.

### Reliability

- Idempotent sends: unique key per campaign + contact + step, checked inside the same transaction that
  marks the message sent.
- `jobs` table with `FOR UPDATE SKIP LOCKED` polling, retries with backoff (1, 5, 30 min), and
  `failed` after 3 tries. Phase 1 runs jobs on demand from tools; Phase 2 adds an always-on worker.
- Failed Google, Gmail or site fetches never lose a lead. The lead stays in its stage and the error is
  stored on the record.

### Operations

- Supabase daily backups (free tier keeps a short history), plus a weekly `pg_dump` you keep yourself.
- Logs: tool calls in `activities`; server errors to stderr, which Claude Desktop keeps in its MCP log.
- Tests: unit tests for scoring, signal detection, consent and suppression checks, idempotency and the
  send queue. Run in CI on every push (GitHub Actions free tier).
- Hosting in Phase 1: everything local, with Supabase in the cloud. The dashboard and `/book` page
  deploy to Vercel's free tier when you need the public booking page.

## Extension design

All business logic lives in a `core` package that MCP tools, dashboard actions and future workers call
alike. Each outside dependency sits behind an interface, so adding a capability means adding an
adapter, not rewriting a module.

### Repo layout (monorepo, pnpm workspaces)

```
agencyos/
  packages/core/        domain logic: leads, scoring, research, outreach, inbox, deals
  packages/adapters/    LeadSource, MailProvider, CalendarProvider, AiProvider, ContactFinder, Payments
  packages/db/          Supabase client, typed queries, migrations
  apps/mcp/             MCP server: thin tool wrappers over core
  apps/web/             Next.js dashboard + /book + /unsubscribe
  apps/worker/          Phase 2: job runner (same core, no new logic)
```

### Interfaces that make Phase 2 and 3 plug-ins

| Interface | Phase 1 adapter | Later adapters |
|---|---|---|
| `LeadSource.search()` | Google Places, CSV | Yelp Fusion, licence boards, purchased data |
| `MailProvider.send()` / `sync()` | Gmail API | Microsoft Graph, multiple inboxes in rotation |
| `CalendarProvider.freeBusy()` / `book()` | Google Calendar | Outlook, Cal.com |
| `AiProvider.complete()` | none (Claude Pro drives through MCP) | Claude API worker, other models for cheap classification |
| `ContactFinder.find()` | manual + website extract | Hunter, Apollo |
| `Payments.createInvoice()` / `verify()` | none | Stripe (via a US LLC), Payoneer, Wise |
| `CrmSync.push()` | none | GoHighLevel API: create the client's sub-account, pipelines and workflows from a snapshot |

### Rules that keep it extendable

- MCP tools and dashboard routes contain no business logic, only input parsing and a call into core.
- Every state change goes through one function per entity (`moveLeadStatus`, `queueMessage`), which
  writes the activity log.
- Long or repeated work is a `jobs` row. In Phase 1 a tool runs it right away; in Phase 2 the worker
  picks the same rows up on a schedule.
- Tables carry `owner_id` from day one, so multi-user or a SaaS version adds RLS policies, not
  columns.
- Prompts and output schemas for Claude live in `core/prompts` and are versioned, so the Claude API
  worker reuses exactly what Pro uses now.

## Build milestones

Eight milestones, each small enough for one or two Claude Code sessions and each ending in something
you can use. Don't start a milestone until the last one's acceptance checks pass. Start warming the
outreach domain during M1, because it takes 2–3 weeks.

1. **M1 — Run v0.1 for real and restructure**
   - Set up Supabase, the Google key and Claude Desktop. Run 3 real searches.
   - Move the code into the monorepo layout (core, adapters, db, apps/mcp).
   - **Done when:** 100+ real leads are saved and scored, tests pass, and tools behave the same after
     the move.
   - *Prompt:* "Restructure this repo into a pnpm monorepo per SPEC section Extension design. Move
     logic into packages/core, keep MCP tools as thin wrappers, keep all tests green."
2. **M2 — Deeper audit and research reports**
   - Multi-page audit with text extract; migration for `research_reports` and `services`;
     `get_research_input`, `save_research_report` and `list_research_queue`.
   - **Done when:** Claude writes 10 reports and each gap has an evidence URL; a report without
     evidence is rejected.
3. **M3 — Contacts and compliance gates**
   - Owner and email capture, `verify_email`, consent basis rules, suppression trigger, `/unsubscribe`
     route.
   - **Done when:** tests prove a Canadian contact with unknown consent and a suppressed contact can't
     be queued.
4. **M4 — Templates, campaigns and approvals**
   - `templates`, `campaigns`, `campaign_members`, `outreach_messages` and `approvals`; drafting and
     approval tools.
   - **Done when:** 20 drafts are created, reviewed and approved through Claude, with nothing sent.
5. **M5 — Gmail sending and inbox sync**
   - OAuth connect flow, encrypted tokens, send queue with limits and hours, `sync_inbox`, threading
     and bounce handling.
   - **Done when:** 10 test emails to your own addresses send once each (retry-safe), replies thread to
     the right lead, and a bounce suppresses the contact.
6. **M6 — Minimal dashboard**
   - Next.js app with Today, Leads, Lead detail, Approvals and Settings, behind a magic-link login.
   - **Done when:** a morning's approvals can be cleared in the browser in under 10 minutes.
7. **M7 — Inbox, replies and booking**
   - Inbox screen, `classify_reply`, `draft_reply`, Google Calendar free/busy, `/book` page, reminders,
     `prepare_call_brief`.
   - **Done when:** a test prospect can reply "interested", get a booking link, book a slot, and see
     the event on your calendar.
8. **M8 — Pipeline and analytics**
   - Deals, Kanban, call outcomes, `funnel_report`, deliverability alerts.
   - **Done when:** the funnel shows real numbers by niche and city, and a test bounce spike pauses
     sending.

**How to brief Claude Code for every milestone:** keep this doc in the repo as `SPEC.md`, name the
milestone number, and ask it to write a short plan first, then migrations, then core functions with
tests, then the tool or screen wrappers. Review each pull request before merging.

## Costs and open decisions

Phase 1 should run on roughly $30–60 a month. The figures below are approximate, from memory rather
than looked up, so check current pricing before you buy.

| Item | Approx. cost | Note |
|---|---|---|
| Claude Pro | ~$20/month | Development (Claude Code) and running the MCP tools |
| Outreach domain | ~$10–15/year | Separate from your main domain |
| Google Workspace mailbox | ~$7–10/month per inbox | Needed for the Gmail API on the outreach domain |
| Google Places API | $0 to low tens of dollars/month | Monthly free usage per pricing tier; cap the quota |
| Supabase | $0 | Free tier; the Pro plan (~$25/month) only when you outgrow it |
| Vercel | $0 | Hobby tier for the dashboard and /book page |

### Open decisions

- [ ] Outreach domain name and Workspace mailbox: needed by M1 so warm-up can start.
- [ ] Business mailing address for email footers (CAN-SPAM and CASL require one): a virtual address in
      the US, or your real Pakistan address.
- [ ] Payment route for Phase 2: Payoneer/Wise invoices, or a US LLC with Stripe.
- [ ] Service catalog and price ranges to load into `services` (setup fee, monthly fee per package).
- [ ] First 3 cities and 2 niches for live campaigns.
- [ ] Google OAuth app type: set it to Internal to your Workspace, so the Gmail read scope doesn't need
      Google's app verification.
