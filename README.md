# AgencyOS

Claude (Pro, in Claude Desktop) finds home-service businesses in the USA and Canada,
saves them to **your Supabase database**, checks their websites, and scores them for
your "Never miss a lead" offer.

```
You ──► Claude Desktop (Pro) ──► AgencyOS MCP server (this repo, runs on your PC)
                                     ├─► Google Places API  (find businesses)
                                     ├─► Their websites     (audit signals)
                                     └─► Supabase Postgres  (store everything)
```

## Repo layout (pnpm workspace)

| Path | What lives there |
|---|---|
| `packages/core` | All business logic: presets, scoring, signal detection, leads, contacts, reports |
| `packages/adapters` | Outside services behind interfaces: `LeadSource` (Google Places), SSRF-safe web fetch |
| `packages/db` | Supabase client and helpers |
| `apps/mcp` | The MCP server: tool definitions only, each one calls `core` |
| `supabase/migrations` | SQL migrations, numbered, never edited after they run |

See `SPEC.md` for the full Phase 1 system design and milestones, and `docs/SPEC-v0.1.md` for the v0.1 scoring rules.

---

## 1. Create the Supabase project (free tier is fine)

1. Go to supabase.com → **New project**. Pick a region close to your leads (e.g. East US).
2. Open **SQL Editor → New query**, paste all of `supabase/migrations/0001_init.sql`, click **Run**.
   Then do the same with `0002_phase1.sql`, and each later file in number order.
   Each one is safe to run again.
3. **Project Settings → API**: copy the **Project URL** and the **service_role / secret key**.

> The service-role key bypasses security. Keep it only in `.env` on your machine.
> Never put it in a browser app or a public repo.

## 2. Get a Google Places API key

1. console.cloud.google.com → create a project → turn on **billing**.
2. **APIs & Services → Library** → enable **Places API (New)**.
3. **Credentials → Create credentials → API key** → **Restrict key** → API restrictions: *Places API (New)* only.
4. **Set a cap**: under **APIs & Services → Places API (New) → Quotas**, lower the daily request limit
   (e.g. 200/day), and add a **budget alert** under Billing. That way a mistake can't run up a bill.

Google gives a free monthly usage allowance for each pricing tier. Phone, website and rating fields
count as a higher tier, so check the current pricing page before you scale up. Each `find_leads`
call makes about 1–3 requests per search phrase.

## 3. Install and build

Needs Node.js 20+ and pnpm (bundled with Node through Corepack). If `pnpm -v` fails, run once:

```bash
corepack enable pnpm
```

(On Windows without admin rights: `corepack enable pnpm --install-directory "%APPDATA%\npm"`.)

```bash
cd agencyos
pnpm install
cp .env.example .env      # Windows: copy .env.example .env   — then fill it in
pnpm build
pnpm test                 # unit tests for scoring, signals, place mapping, SSRF guard
```

The `.env` file stays in the repo root, next to `pnpm-workspace.yaml`.

## 4. Connect to Claude Desktop

Claude Desktop → **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\claude_desktop_config.json`). Add:

```json
{
  "mcpServers": {
    "agencyos": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\code\\agencyos\\apps\\mcp\\dist\\index.js"]
    }
  }
}
```

Fully quit and reopen Claude Desktop. **agencyos** should show up in the tools/connectors menu
with 11 tools. The server reads keys from `agencyos/.env` (the repo root), so you don't need to put keys in this file.

## 5. Use it — example prompts

- *"Dry-run import of C:\Users\PC\Downloads\leads.csv, then import it if the columns look right."*
- *"Find 20 HVAC companies in Dallas, TX and save them."*
- *"Audit the websites of the leads you just found."*
- *"Show me high-tier leads in Texas with fewer than 50 reviews."*
- *"Open the top lead and tell me the 3 biggest gaps you'd pitch on."*
- *"Find 20 roofers in Calgary, AB, audit them, and give me the pipeline summary."*
- *"Mark Acme HVAC as ready_for_outreach and note: owner is Mike, pitch missed-call text-back."*

Tip: let the tools do the heavy work. They return short summaries, not raw pages, so you use
less of your Pro limit per lead.

## Tools

| Tool | What it does |
|---|---|
| `list_niches_and_markets` | Niche presets + starter cities |
| `find_leads` | Google Places search → dedupe → save → first score |
| `import_leads_csv` | Import a CSV of businesses + contacts (dedupe, suppression, consent basis). Try `dry_run` first |
| `audit_websites` | Homepage check (booking, chat, ad pixels, GHL, emails) → re-score |
| `list_leads` | Filter by status / tier / niche / city / score |
| `get_lead` | Full record + score reasons + audit + contacts + history |
| `update_lead` | Change status, add notes (logged) |
| `add_contact` | Save a person/email with source + consent basis |
| `verify_email` | Syntax + mail server + suppression check; says if a contact can legally be emailed |
| `suppress` | Never-contact list (email or domain) |
| `pipeline_summary` | Counts per stage + recent searches |

## Troubleshooting

- **Tools don't appear**: check the path in the config uses `\\` on Windows, run `pnpm build`,
  then restart Claude Desktop fully (quit from the tray, not just close the window).
  Logs: Settings → Developer → agencyos → *Open logs*.
- **"Missing env var"**: `.env` must sit in the repo root (the `agencyos` folder), next to `pnpm-workspace.yaml`.
- **Google 403**: Places API (New) isn't enabled, billing is off, or the key restriction is wrong.
