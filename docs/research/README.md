# Researching leads with an external AI tool

Research leads with any AI tool that can browse the web (ChatGPT with search or Agent mode,
Perplexity, Gemini, Manus) instead of Claude, then import the results into AgencyOS.
The results land on each lead page under **Research**, marked "Researched by: External AI".

Lead data never goes into git: everything below lives in `data/research/`, which is gitignored.

## The loop

Run the commands from `D:\business`. Run `pnpm build` once first, so the scripts can load the shared rules.

**1. Export a set of leads**

```bash
node scripts/export-research.mjs --limit 200 --batch-size 20
```

This writes `data/research/batches/batch_01.csv … batch_10.csv` (20 leads each, best first)
and `_hints.csv`. The hints file has our website-audit signals and top recommended offer per lead,
so you can paste the matching rows under a batch if the AI should check our findings.
Leads that already have a report are left out, unless you add `--include-researched`.

**2. Research one batch**

Open the AI tool, start a new chat, and paste the **PROMPT** section of
[`RESEARCH_PROMPT.md`](RESEARCH_PROMPT.md). Under it, paste the full contents of one batch file.
If it stops part-way, reply "continue from the next lead_id".

**3. Save the answer**

Save the CSV it returns as `data/research/results_01.csv`, numbered like the batch.
It must keep the header from [`results_TEMPLATE.csv`](results_TEMPLATE.csv) (43 columns).

**4. Spot-check, then import**

Open 2–3 rows' evidence links (`gap_N_evidence_url`, `email_source_url`) and confirm they say
what the row claims. If links are fake or don't back the claim, throw the batch away. Then:

```bash
node scripts/import-research.mjs data/research/results_01.csv --dry-run
```

```bash
node scripts/import-research.mjs data/research/results_01.csv
```

The dry run shows what would happen without saving. Do 2–3 batches a day.

## What the import does

| In the CSV | In AgencyOS |
|---|---|
| `lead_id` | Matched to the lead (`lead_ref`). Unknown IDs and the `EXAMPLE-…` row are skipped |
| `gap_1…3` + evidence URLs | Gaps on the report. **A gap without a real URL is dropped**; if gaps were listed but none had a URL, the row is rejected. A row with no gaps at all (research verified nothing) is skipped. `closed` / `website_down` rows are always kept |
| wrong number of columns | AI tools sometimes drop or add a cell. If the slip is only in the gap columns the row is realigned; otherwise it's rejected: research that lead again |
| `recommended_offer`, `second_offer` | Must be one of the 7 offer keys, or `none`. Anything else rejects the row |
| `offer_reason`, `email_hook`, `discovery_questions`, `confidence` | Report summary, email opener, call questions (split on ` \| `), confidence (clamped to 0–1) |
| `google_rating`, `google_review_count` | Saved on the lead **only** if `reviews_source_url` is filled |
| `fit_score` | The lead's score (and tier) |
| `status = closed` | Stage → Disqualified, with the note "closed per research" |
| anything else | Kept on the report (`raw`), so nothing is lost |

The import also does three more things to the lead:
- **Stage:** a lead on *New* moves to *Researching*. Stages never move backwards.
- **Touch:** it logs one *Research* touch (0 minutes, "External AI research") per lead.
- **Re-import:** importing the same file again updates the lead's latest external report instead of adding another.

**Contacts are only added from facts published on the business's own site, and existing ones are never overwritten:**

- `best_email` is added only if `email_on_own_site = yes` and `email_source_url` is a URL.
- **Consent:** US → `can_spam_b2b`. Canada → `casl_implied_published` only when `no_unsolicited_email_notice = no`;
  otherwise `unknown`, which means don't email.
- `no_unsolicited_email_notice = yes` → the contact is marked **do not contact**.
- `owner_name` with `owner_name_source_url` → an owner contact with a link to where the name was found.

The import prints how many rows were imported, updated, skipped and rejected, with the reason for each.
If any row was rejected it exits with an error, so you notice: fix or re-research those rows and import again.
