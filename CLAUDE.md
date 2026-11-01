# CLAUDE.md: handoff for anyone (or any Claude) continuing this project

Read this first. It sums up the build so far and how the owner wants work done. The detailed product
spec is `SPEC.md`; setup guides are in `docs/`.

**This repo is public.** Never commit secrets, `.env`, lead or contact data, or personal email
addresses. Lead data lives in the gitignored `data/` folder.

## What this is

**The Sentinel Systems** (internal codename *AgencyOS*): the in-house system for a GoHighLevel (GHL)
automation agency selling to US and Canadian home-service businesses (HVAC, plumbing, roofing,
garage doors, restoration…). It takes a business from "found" to "paying client": lead discovery and
audit, research and offer recommendations, a team CRM, and email outreach with reply tracking.

- Team: **Moawiz** (owner) and **Abdullah** (partner). Staff only, no customer logins.
- Staff web app: **https://agencyos.thesentinelsystems.com**. It's staff-only on purpose: `/` redirects
  to sign-in or `/dashboard`, it's `noindex`, and robots.txt disallows everything. **Don't put marketing
  content there**: the main domain `thesentinelsystems.com` is reserved for a separate customer-facing site.
- Business mailboxes (GoDaddy Professional Email on Titan): `moawiz@thesentinelsystems.com`, `masna@thesentinelsystems.com`.

## Repo layout

| Path | What |
|---|---|
| `SPEC.md` | Product spec, data model, milestones M1–M8 (`docs/SPEC-v0.1.md` = older scoring rules) |
| `packages/core` | Business logic: scoring, audit, signals, offers, compliance (CASL/CAN-SPAM), CSV import, research import (`research-import.ts` realigns slipped columns from AI-tool CSVs) |
| `packages/adapters` | Google Places, website fetch, email DNS/MX checks |
| `packages/db` | Supabase client |
| `apps/mcp` | MCP server (stdio) used from Claude Desktop/Code via `.mcp.json`: find_leads, audit_websites, list_leads, get_lead, update_lead, add_contact, verify_email, import_leads_csv, research tools, pipeline_summary… |
| `scripts/*.mjs` | Node scripts using the service key from `.env`: `setup-team`, `import-leads`, `import-research`, `export-research`, `import-sequences` |
| `supabase/migrations` | SQL migrations `0001`–`0007`, all **applied on live** |
| `supabase/test` | Database tests on PGlite (real Postgres in WASM) with Supabase auth stand-ins (`harness.mjs`) |
| `web/` | Standalone **npm** Next.js 16 app (not part of the pnpm workspace): React 19, Tailwind v4, shadcn/ui, `@supabase/ssr`. Deployed on Vercel from `main` (root dir `web`) |
| `docs/GO-LIVE.md`, `docs/GMAIL.md`, `docs/WEB-FORM.md` | Setup guides (database, auth, deploy; email inboxes; website form embed) |
| `docs/research/` | External-AI research workflow: prompt, CSV template, how to import |
| `data/` (gitignored) | Lead CSVs, research results, outreach sequences/plans. Not in git: copy it separately |

## Commands

```bash
pnpm install
```
```bash
pnpm build
```
```bash
pnpm test
```
```bash
pnpm test:db
```
```bash
cd web && npm install && npm run dev
```
```bash
cd web && npm test && npx eslint && npx tsc --noEmit && npm run build
```

On Windows PowerShell use `pnpm.cmd` (pnpm is a corepack shim in `%APPDATA%\npm`). `web` tests use
`node --test` on `.ts` files directly (Node 24), so `web/tsconfig.json` has `allowImportingTsExtensions`
and excludes `*.test.ts`.

## How the owner wants work done (keep these)

- **One feature branch + PR per chunk of work; the owner merges.** Don't push to `main`. End commit messages
  with the co-author line and PR bodies with the Claude Code line, as before.
- **Never run anything against the live Supabase without asking first** (imports, scripts, writes). Read-only
  checks with the service key are fine. Dry-run scripts first (`--dry-run`).
- **The owner runs SQL migrations themselves** (Supabase → SQL Editor). New schema = a new numbered file;
  never edit an applied one. Migrations must be re-runnable. After `0007`, don't re-run `0006`.
- **No service-role key in the browser or on Vercel.** The web app uses the anon key + RLS. The mail worker
  uses the anon key + `MAILER_SECRET` (which only opens `mailer_*` functions).
- **CI is disabled** at the owner's request. Run tests/lint/build locally before opening a PR.
- **Don't create auth accounts** for people; the owner approves sign-ins.
- Keep lead/contact data and CSVs out of git. Keep the repo free of personal emails.
- Explain things in plain language; the owner isn't a developer. Give click-by-click setup steps.
- **Decided / rejected, don't redo:** PR #14 (building for iOS 15 Safari + server-rendered login) was
  **rejected**. Keep Next's default browser targets. No public marketing site on the subdomain.

## Architecture notes

### Database and auth (`0003`, `0005`)
- `team_members` (owner/partner, `active`). RLS: only active members see anything; only owners delete or
  manage the team. Helpers `current_member_id()`, `is_team_member()`, `is_team_owner()` (SECURITY DEFINER).
- **Sign-up approval:** any new Google/email sign-in gets an inactive `team_members` row ("Waiting for
  approval" screen) until the owner sets `active = true` in the Table Editor.
- `touches` roll up into `companies` (touch count, minutes, last touch) and move `stage` **forward only**.
  Stage/owner changes are logged to `activities`.
- Login: Google OAuth (Supabase), password, email link. `web/proxy.ts` (Next 16's middleware) refreshes
  sessions, forwards stray `?code=` to `/auth/callback`, and lists the public paths.

### Research and offers (`0004`)
- `research_reports` (one external-AI report per lead is updated on re-import), `companies.recommended_offers`.
- Offer keys (fixed): `online_booking, missed_call_textback, speed_to_lead, review_automation, website_gbp,
  ghl_optimisation, fsm_integration`.
- The research rubric (`docs/research/RESEARCH_PROMPT.md`) gives **−15 for already using GHL**, but the owner
  treats GHL users as **high priority** (pitch: GHL optimisation). The 15 `MANUS-001…015` leads were re-scored
  with GHL as **+15** and +20 for a verified site defect. The other 1,000 leads still use the rubric.

### Email (`0006`, `0007`)
- Each member connects **several inboxes**: Gmail (OAuth: `gmail.send` + `gmail.readonly`) and
  **IMAP/SMTP** (GoDaddy/Titan: `imap.titan.email:993` / `smtp.titan.email:465`, classic GoDaddy
  `imap.secureserver.net` / `smtpout.secureserver.net`; the connect form tries both). One is the default.
- Gmail refresh tokens and IMAP passwords are **AES-256-GCM encrypted on the server** (`MAIL_TOKEN_KEY`),
  bound to the mailbox address; `mail_accounts` isn't readable through the API.
- `outreach_messages`: written only through functions (`queue_email`, `approve_email`, `update_email`,
  `cancel_email`). Only the author approves (it sends from their inbox). Inbox choice: the one named, else
  the inbox that last emailed that contact (keeps the thread), else the default.
- **Worker:** pg_cron calls `POST /api/mail/tick` every 5 min with `CRON_SECRET`. It syncs each inbox, then
  sends ≤1 due email per inbox. Guards: kill switch `settings.sending_enabled` (owner toggles on the Account
  page), per-inbox daily limit, 2-minute gap, suppression/do-not-contact/bounced/consent (CASL for Canada),
  signature (postal address) required, opt-out line auto-added, never sends a fake "Re:" when the first email
  isn't synced.
- **Unsubscribe and bounce guard (`0008`):** outreach sends carry `List-Unsubscribe` + one-click POST
  (`/api/unsubscribe`, signed per address with a key derived from `MAIL_TOKEN_KEY`, `lib/mail/unsubscribe.ts`);
  people who open the link get `/unsubscribe` with a confirm button. `mailer_unsubscribe` suppresses the address,
  marks contacts do-not-contact, cancels pending email. A trigger on `inbound_messages` switches sending off
  when 2+ bounces in 24 h exceed 3% of sends (`settings.sending_paused`, shown on Account; turning sending on clears it).
- **Sync** stores only messages to/from contacts: sends made in the inbox itself → touch + "contacted";
  replies → "replied" + stop pending follow-ups; "no"/"unsubscribe" → suppression + do-not-contact;
  bounces → email marked bounced; out-of-office → recorded, doesn't stop anything.
- IMAP threads are named after the first Message-ID (`rfc:<id>`); bounces are matched through the original
  headers quoted in the delivery report.
- **Mailbox page** (`/mailbox`): a full mail client for the member's own IMAP inboxes, read **live** from
  the server (nothing stored in the DB). Folders (Inbox, Sent, Drafts, Archive, Spam, Trash), search, opening
  marks read, star / unread / archive / delete (= move to Trash, never permanent), attachment downloads
  (`/api/mailbox/attachment`, always a download). HTML email shows in a sandboxed iframe with a strict CSP;
  remote images stay hidden until "Show images". Compose / reply / reply all / forward with attachments (≤4 MB)
  sends **straight away** over SMTP and files a copy in Sent (`sendDirect`). The kill switch and daily limit
  govern scheduled outreach only; hand-written mail still obeys the never-contact list, do-not-contact,
  bounces and (for new emails to non-won leads) consent/CASL, adds the opt-out line then, max 20 recipients
  (`lib/mail/compose.ts`). Mail to a lead is logged by the sync, which runs right after the send.
  Lead contacts have a "Write now" link into the composer. **Schedule send** (`0009`, `scheduled_mail`, no
  attachments): the final text is stored at scheduling time; the worker sends due ones per inbox
  (`mailer_claim_scheduled` re-checks the never-contact list) and the Mailbox has a Scheduled view. Gmail inboxes aren't in the Mailbox yet.
- Vercel env (names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `MAIL_TOKEN_KEY`,
  `MAILER_SECRET`, `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `APP_URL`,
  `NEXT_PUBLIC_TEAM_TIME_ZONE` (default `Asia/Karachi`). **Account → Email inboxes → Setup check** shows
  which are missing/wrong without revealing values. Don't change `MAIL_TOKEN_KEY` (stored secrets would
  stop decrypting).

### Tasks, deals, reply labels (`0012`)
- `tasks` (optional lead, assignee, due, done; team RLS, delete = creator or owner). `/tasks` lists mine/everyone by
  overdue / today / coming up / no date, and includes leads whose `next_step_at` is within a week (ticking clears it).
  Lead page: Tasks card + Deal card (the Status card no longer edits deal value).
- `deals`: one per lead (`deals_company_uq`), offer key, setup + monthly fee, stage open/proposal_sent/won/lost.
  `saveDeal` mirrors first-year value into `companies.deal_value_cents` and moves the lead to proposal_sent/won/lost.
- `classify_reply(id, label)`: interested/meeting_request -> stage interested + task "Send X the booking link";
  question/pricing -> at least replied; not_now -> nurture, stop pending, task in 60 days; not_interested -> lost;
  unsubscribe -> suppress. Inbox shows label buttons with a suggestion (`lib/replies.ts`, keyword rules) and a
  suggested answer using `booking_url()` (owner sets it on Account).
### Website form (`0011`, `docs/WEB-FORM.md`)
- Public `POST /api/forms/contact` (CORS: `FORM_ORIGINS`, default the main domain + www) and an embeddable
  `/forms/contact` page (iframe, always light, posts its height to the parent). `lib/forms.ts` traps bots (hidden
  `company_url`, <3 s) and answers them "ok". `web_form_submit` (worker secret) rate-limits per IP hash (5/h, 200/day),
  joins a lead by email then website domain or creates one (`source web_form`, stage interested), sets the contact
  to `express` consent, pins a note and adds an unhandled "Website enquiry" to the Inbox.
### Sequences (`0010`)
- A sequence = a `campaigns` row; steps = `templates` rows in `template_ids` order, days in `step_days`, sent at
  `send_time` in each lead's time zone, moved off weekends. `/sequences` + `/sequences/[id]` (steps editor with merge
  fields + preview, add leads by filter, approve all, pause/resume, remove a lead); Leads table bulk action "Add to sequence".
- `enroll_in_sequence` picks each lead's best emailable contact (named person before shared inbox, `outreach_block_reason`
  clear), skips closed leads / already enrolled / already has emails waiting, and inserts `pending_approval` drafts from the
  enrolling member (later steps with no subject become `Re: <step 1 subject>` so they thread). `merge_template` fills
  `{{first_name}} {{full_name}} {{company}} {{city}} {{trade}} {{website}} {{personal_line}}` (research hook) `{{my_name}}`;
  `lib/sequences.ts` mirrors it for previews and rejects unknown tags. Pausing sends approved emails back to approval.

### Web app
- `/reports` (no migration; reads through RLS, `lib/reports.ts`): funnel (how far each lead got; lost/nurture count
  up to touches/replies) overall + by trade + by state, deliverability per inbox and per day (14 days, bounce alarm = the
  0008 guard rule), pipeline money from `deals` (open setup/monthly, weighted by probability, won MRR).
- Routes: `/dashboard`, `/leads`, `/leads/[id]` (Email card: compose/schedule in the lead's time zone,
  approve, send now, replies), `/pipeline`, `/inbox` (replies to handle, approvals, failures), `/mailbox`,
  `/account` (inboxes, signature, limits, kill switch, password), `/privacy`, `/terms` (public; Google's app
  review links to them), `/login`.
- Branding: shield mark + deep-blue primary (`components/brand.tsx`, `app/globals.css`), dark mode via
  `next-themes` (`components/theme.tsx`), PWA (`app/manifest.ts`, generated icons, `public/sw.js`, which never
  caches CRM pages).
- Dates show in `TEAM_TZ` (Pakistan); send times are entered in the **lead's** time zone (`lib/tz.ts`,
  `lib/region-tz.json`).

## Live state (as of 2026-11-01)

- Live: migrations 0001–0007 (0008+ are in open PRs until the owner runs them), PRs #1–#13 merged and deployed. PR #14 closed (rejected).
- ~1,015 leads: 1,000 imported from CSV (101 with external-AI research reports) + 15 `MANUS-*` GHL leads
  (all owned by Moawiz) with research, verified contacts and owner names.
- Connected inboxes: both GoDaddy mailboxes, with signatures. **Moawiz's personal Gmail is not connected yet.**
- **Sending is OFF** (kill switch). Nothing has been sent from the system.
- **40 follow-up emails (Email 2–5 for 10 MANUS leads) are loaded as "needs approval"**, scheduled at
  07:45 lead-local time from 9–24 Nov. Email 1 was to be sent **by hand from Moawiz's personal Gmail** on 4–5 Nov,
  so the follow-ups go from that Gmail once it's connected and synced.
- Google Cloud (same project as Google login): Gmail API on, "AgencyOS Gmail" OAuth client, publishing status
  **Testing**: test users must be added (or the app published after completing Branding with the privacy/terms URLs).

## Open items / next steps

1. Connect Moawiz's Gmail (fix test users or publish the app), sync, then approve the 40 follow-ups and turn
   sending on before 9 Nov.
2. SPF for Titan sending: `v=spf1 include:secureserver.net include:spf.titan.email -all`; add DMARC; test on
   mail-tester.com. Warm up the domain inboxes 2–3 weeks (daily limit ~5) before cold outreach from them.
3. The owner's iPhone runs iOS < 16.4, so the Next 16 app doesn't work in its Safari (won't be fixed in code:
   see rejected PR #14). Use a newer device or update iOS.
4. Rotate the Supabase service-role key (it was shared in an earlier chat) and update `.env`.
5. Possible next work (ask first): Microsoft 365 inboxes, reply-from-Mailbox, the remaining SPEC milestones
   (templates/campaigns M4, booking M7, analytics M8), re-research the leads the external AI couldn't verify
   (batches 2, 3, 8, 9 and a few rejected rows).

## Gotchas

- This PC's DNS drops connections now and then (`git`, `gh`, `curl`, `npm` fail with "could not resolve
  host"): just retry.
- Next.js 16: `proxy.ts` replaces `middleware.ts`; route files may only export route handlers/config (put
  shared constants in `lib/`); layouts can't export arbitrary values either.
- Tests: `pnpm test:db` (PGlite) and `cd web && npm test` (`node --test`). Add a test with each behaviour change.
- External-AI research CSVs often have wrong column counts; `import-research` realigns gap-column slips and
  rejects the rest. Always dry-run first.
