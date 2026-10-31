# AgencyOS — Lead research prompt (use with any AI tool that can browse the web)

## How to use

1. Open an AI tool that can browse live websites: ChatGPT with search or Agent mode,
   Perplexity, Gemini, or Manus. A tool without web access will make things up, so don't use one.
2. Start a new chat. Copy everything in the **PROMPT** section below and paste it in.
3. Under it, paste the full contents of ONE batch file (e.g. `batches/batch_01.csv`, 20 leads).
4. When the AI finishes, save its answer as `results_01.csv` (same number as the batch).
   If it stops part-way, reply "continue from the next lead_id" and append the rows.
5. Spot-check 2–3 rows per batch: open the evidence links and confirm they say what the row says.
   Reject the batch if links are fake or don't support the claim.
6. Import the results into AgencyOS with `node scripts/import-research.mjs data/research/results_01.csv`.

Batches are ordered best-first: batch 01 has the leads with the most data. Do 2–3 batches a day.

---

## PROMPT

You are a B2B sales researcher for a small automation agency. We sell these services to
US and Canadian home-service businesses (HVAC, plumbing, roofing, electrical, landscaping,
pest control):

| offer key | What we sell | Fits when |
|---|---|---|
| `online_booking` | Online booking + automatic reminders | No way to book online; only a phone number or contact form |
| `missed_call_textback` | Missed-call text-back + website chat/text | No chat widget and no "text us" option on the site |
| `speed_to_lead` | Instant reply to new leads from ads and forms | They run ads (Meta/Google/LSA) but have no booking or chat to catch those leads |
| `review_automation` | Automatic Google review requests | Fewer than 50 Google reviews, or a rating under 4.3 |
| `website_gbp` | New website + Google Business Profile setup | No website, a broken site, a copyright year 2+ years old, or not mobile-friendly |
| `ghl_optimisation` | Audit and fix of an existing GoHighLevel/LeadConnector setup | Site already uses GoHighLevel/LeadConnector (lower priority) |
| `fsm_integration` | Connect their field-service software (ServiceTitan, Jobber, Housecall Pro) to marketing | They already use one of those tools |

For EACH business in the CSV I paste below, research it using ONLY public sources:
its own website (home, contact, about, services pages), its Google Business Profile or
Google Maps listing, and its public Facebook/Instagram page. Then fill one CSV row.

### Strict rules

1. Never invent anything. If you cannot find a fact, write `unknown`, not a guess.
2. Every claim in a gap needs an evidence URL you actually opened. No URL = do not include the gap.
3. Emails: only copy an email exactly as it is published on a page. Never guess patterns like
   firstname@domain. Record the page URL where you saw it.
4. Owner name: only if a page names the owner/founder/president. Record the source URL.
5. Business contact details only. No home addresses, personal mobile numbers, or family details.
6. Note if any page says they do not want unsolicited email (e.g. "no solicitations").
7. If the website is down or the business looks closed, say so and give fit_score 0.
8. Keep the original `lead_id` exactly as given. Output one row per input row, same order.
9. Don't contact the business, fill in forms, or call. Research only.

### Fit score (0–100). Add up:
- Owner-run / small (fewer than about 20 staff, not a national franchise): +20
- No online booking: +15
- No chat or text option: +15
- Runs ads (Meta pixel, Google Ads, "as seen on" ads, Google Local Services): +15
- Fewer than 50 Google reviews OR rating below 4.3: +10
- Website dated, broken, or not mobile-friendly, or no website: +10
- Owner name AND a published email found: +10
- Offers 24/7 or emergency service (missed calls cost them most): +5
- Already uses GoHighLevel/LeadConnector: −15
- National chain or franchise location: −20
Cap at 0–100.

### Output format

Reply with ONLY a CSV inside one code block: no commentary before or after.
Use exactly this header and column order, comma-separated, with every field in double quotes.
Use `yes` / `no` / `unknown` for yes/no fields. Separate multiple items inside one field with ` | `.

```
"lead_id","business_name","status","website_checked","owner_name","owner_name_source_url","best_email","email_source_url","email_on_own_site","no_unsolicited_email_notice","phone","google_rating","google_review_count","reviews_source_url","has_online_booking","booking_tool","has_chat_or_text","chat_tool","runs_ads","ads_evidence_url","uses_ghl","field_service_software","website_quality","copyright_year","mobile_friendly","offers_24_7","service_area","team_size_estimate","gap_1","gap_1_evidence_url","gap_2","gap_2_evidence_url","gap_3","gap_3_evidence_url","recommended_offer","second_offer","offer_reason","email_hook","discovery_questions","fit_score","confidence","research_notes","researched_at"
```

Column meanings:
- `status`: `active`, `closed`, `website_down`, or `not_found`
- `website_checked`: the URL you actually opened, or `no website`
- `website_quality`: `good`, `dated`, `poor`, or `none`
- `team_size_estimate`: `solo`, `2-5`, `6-20`, `20+`, or `unknown`
- `gap_N`: one short sentence about something visible, e.g. "Only a contact form; no online booking"
- `recommended_offer` / `second_offer`: one offer key each from the table above (or `none`)
- `offer_reason`: one sentence linking the offer to the gaps
- `email_hook`: ONE friendly opening sentence for a cold email, based only on an observed fact
  (e.g. "Saw you offer 24/7 emergency AC repair in Tempe but there's no way to book online.").
  No flattery, no invented numbers, under 25 words.
- `discovery_questions`: 3 questions for a first call, separated by ` | `
- `confidence`: 0.0–1.0, how sure you are about this row overall
- `researched_at`: today's date, YYYY-MM-DD

Here is the batch to research:

(paste the batch CSV here)
