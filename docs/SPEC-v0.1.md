# AgencyOS — Lead Discovery Spec (v0.1)

## Goal

Build a steady list of **qualified home-service businesses in the USA and Canada** for the
"Never miss a lead" offer (missed-call text-back, instant lead reply, online booking, review
automation on GoHighLevel). The list lives in Supabase, and Claude Pro runs everything through MCP.

**Success for v0.1:** 100+ scored leads across 2–3 cities, with the top 20 good enough to contact.

## Scope

| In v0.1 | Later |
|---|---|
| Google Places search + dedupe + save | Email sending (Gmail API) + reply sync |
| Homepage audit + rule-based scoring | AI research report per lead |
| Contacts with source + consent basis | Outreach drafts + approval queue |
| Status pipeline + activity log | Dashboard (Next.js) on the same Supabase DB |
| Suppression list | Scheduled runs / Claude API (when buyers appear) |

## Architecture

- **Claude Desktop (Pro)** is the operator. It decides which tool to call and explains the results.
- **MCP server** (`src/index.ts`, stdio, runs on your PC) holds all the logic and keys.
  Claude never sees the database keys.
- **Supabase Postgres** is the single source of truth. A future dashboard reads the same tables.
- The tools do bulk work server-side and return **compact JSON**, to save Pro usage.

## Data model (`supabase/migrations/0001_init.sql`)

| Table | Purpose | Key rules |
|---|---|---|
| `companies` | One row per business | `google_place_id` unique (dedupe); `website_domain` indexed |
| `contacts` | People/emails per company | unique (company, lower(email)); `source_url`, `consent_basis`, `do_not_contact` |
| `search_runs` | Every search made | counts of found vs new |
| `website_audits` | Each homepage check | `signals` JSONB, error, http status |
| `activities` | Audit trail | discovered, audited, status_changed, note, contact_added |
| `suppressions` | Never contact | unique lower(email) / lower(domain) |
| `pipeline_summary` (view) | Counts per status | |

**Statuses:** new → review / qualified → ready_for_outreach → contacted → replied → interested →
meeting_booked → proposal_sent → won / lost (or disqualified).
The scorer only moves leads between `new`, `review` and `qualified`. Later stages are always yours.

RLS is enabled with no policies. Only the service-role key (the server) has access.

## Lead flow

1. `find_leads(niche, city, country)`: runs each preset phrase as "<phrase> in <city>" on Places
   Text Search (max 60 results), drops place IDs already in the DB, inserts the new ones, then scores
   them without an audit (max ~55, so tier "medium" at best).
2. `audit_websites()`: for unaudited leads, checks robots.txt, fetches the homepage with an SSRF guard
   (public IPs only, ports 80/443, 4 redirects max, 1.5 MB cap, 10 s timeout), detects signals, stores
   the audit, and re-scores.
3. You review the high tier with `list_leads` / `get_lead`, add contacts, and move leads along.

## Scoring (`src/scoring.ts`), 0–100

| Signal | Points |
|---|---|
| Operating business in the target niche | +20 (not operational → disqualified) |
| Has phone | +5 |
| < 50 reviews / 50–149 / > 1000 | +15 / +8 / −10 |
| Rating < 4.3 | +10 |
| Has website (or none: +5, offer a site instead) | +5 |
| No online booking | +15 |
| No chat widget | +10 |
| No "text us" / SMS link | +3 |
| No review widget | +2 |
| Ad pixel (Meta / Google Ads / TikTok / Bing) | +15 (paying for leads they may be losing) |
| Not mobile-friendly | +5 |
| Already on GoHighLevel / LeadConnector | −15 |
| Uses ServiceTitan / Housecall Pro / Jobber | −5 (pitch an integration instead) |

**Tiers:** ≥70 high → `qualified`; 50–69 medium → `review`; <50 low → stays `new`.
Every lead stores its `score_breakdown.reasons`, so the score is always explainable.
**Re-weight after your first 50 outreach results.**

## Compliance built in

- **Canada (CASL):** cold email only to addresses that are openly published (e.g. on the company's
  own site) with no "no unsolicited email" notice, and only about their business. Store `source_url`
  and set `consent_basis = casl_implied_published`. The audit captures emails published on the site.
- **USA (CAN-SPAM):** B2B cold email is allowed with an honest subject line, your physical address and
  a working opt-out (`can_spam_b2b`).
- `suppress` is checked before any contact is saved. Outreach (later) must check it before sending.
- **Google Maps Platform terms:** the place ID can be stored indefinitely, but most other Places content
  has caching limits. `google_data_fetched_at` is recorded on each row. Before you scale, read the
  current terms. The plan is to refresh Google fields periodically and to rely on details you verify on
  the business's own website (phone, email, services) as your long-term record.
- The website check identifies itself, respects robots.txt and fetches only one page per lead.

## Next milestones

1. **Research report** tool: fetch 3–5 key pages, return condensed text, and have Claude write
   observed / inferred / unverified findings plus discovery questions into a `research_reports` table.
2. **Outreach drafts** plus an approval queue (`outreach_messages`). Send via the Gmail API from a
   separate outreach domain.
3. **Reply sync** and classification, then booking.
4. **Next.js dashboard** on the same Supabase project.
5. When buyers appear: scheduled runs plus the Claude API for unattended research.
