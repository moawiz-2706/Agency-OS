# Go live: Basic CRM v0

About 30 minutes, start to finish. Run every command from the repo folder (`D:\business`)
unless a step says otherwise. On Windows, use Command Prompt, or `pnpm.cmd` in PowerShell.

## 1. Database (Supabase SQL Editor)

Supabase → your project → **SQL Editor → New query**. Paste each file and click **Run**, in order.
Each one is safe to run again.

| File | Status on your project |
|---|---|
| `supabase/migrations/0001_init.sql` | already run |
| `supabase/migrations/0002_phase1.sql` | already run |
| `supabase/migrations/0003_crm.sql` | **run this now** |

Check: **Table Editor** now shows `team_members`, `touches` and `notes`.

## 2. Supabase Auth settings

1. **Authentication → Sign In / Providers → Email**: enabled. Turn **off** "Allow new users to sign up".
   Only people created in step 3 can log in.
2. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000` for now (you'll change it in step 7)
   - Redirect URLs: add `http://localhost:3000/**`

## 3. Create the team

In `.env` (repo root, next to `package.json`), add:

```
TEAM_EMAILS=you@youragency.com,partner@youragency.com
TEAM_NAMES=Moawiz,Partner
ASSIGN_REGIONS_A=ON,AB,BC,AZ,TX
```

The first email becomes the **owner**, which is the only role that can delete. Then run:

```bash
pnpm install
```

```bash
node scripts/setup-team.mjs
```

It prints each user as created or existing. It's safe to run again, for example after adding a third email.

## 4. Import the leads

The CSVs live in `data/`, which git ignores, so contact data never reaches GitHub.
Put `agencyos-leads-1000.csv`, and `agencyos-leads-1000.enriched.csv` if you have it, in `data/`.

Preview first. Nothing is saved:

```bash
node scripts/import-leads.mjs data/agencyos-leads-1000.csv --dry-run
```

Then import for real:

```bash
node scripts/import-leads.mjs data/agencyos-leads-1000.csv
```

```bash
node scripts/import-leads.mjs data/agencyos-leads-1000.enriched.csv
```

- **Owners:** `--assign=region` (the default) gives the owner ON, AB, BC, AZ and TX, and the partner the rest.
  Use `--assign=even` to alternate, or `--assign=none` to skip. Owners are only set on leads that have none.
- **Re-running:** updates the data columns only. It never changes owner, stage or history, and never duplicates.
- **Already-imported leads:** the 1,000 leads loaded earlier through Claude are matched by name + region,
  website or phone, and get their `lead_ref`. They are not duplicated.

## 5. Run it locally

```bash
cd web
```

```bash
copy .env.local.example .env.local
```

Fill in `.env.local` from Supabase → **Project Settings → API**: the Project URL and the **anon / publishable** key.
Never the service-role key: this file is for the browser.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000, enter your email, and click the link in the email **in the same browser**.
The sign-in check is tied to that browser.

## 6. Deploy on Vercel

The code must be on GitHub first. Merge the open pull requests into `main`, or deploy straight from the branch.

1. vercel.com → **Add New → Project** → import `moawiz-2706/Agency-OS`.
2. **Root Directory**: `web`. Framework: Next.js (detected).
3. **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon / publishable key
   - optional: `NEXT_PUBLIC_TEAM_TIME_ZONE` = `Asia/Karachi` (the default)
4. **Deploy**. Note the URL, for example `https://agency-os.vercel.app`.

## 7. Let Supabase send people to Vercel

Supabase → **Authentication → URL Configuration**:

- Site URL: `https://YOUR-APP.vercel.app`
- Redirect URLs: keep `http://localhost:3000/**` and add `https://YOUR-APP.vercel.app/**`

Sign in on the Vercel URL. You're live.

## Day to day

- **Log time:** open a lead, use **Log activity** (channel, outcome, minutes), and add a next step.
  Logging moves the stage forward automatically: a sent email or a no-answer call becomes *contacted*,
  a reply becomes *replied*, and so on. Stages never move backwards on their own. Change them by hand
  on the lead page, or in bulk from Leads.
- **Dashboard:** shows the last 7, 30 or 90 days, including where each partner's time went.
- **The Claude/MCP tools** still work alongside the CRM. They use the service key and see everything.

## If something's wrong

| Symptom | Fix |
|---|---|
| "That email is not on the team" | Add it to `TEAM_EMAILS` and run `node scripts/setup-team.mjs` |
| Signed in but "Not on the team" | That person's `team_members` row is missing or `active` is false |
| Link opens the login page again | Open it in the same browser you requested it from, and check the Redirect URLs (steps 2 and 7) |
| Emails stop arriving | Supabase's built-in mailer only sends a few emails per hour. Add your own SMTP under Authentication → Emails |
| Dashboard is empty | Nothing is logged yet. Log an activity on any lead |
