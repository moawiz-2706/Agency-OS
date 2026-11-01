# Gmail: send from the CRM, sync replies back

Each team member connects their own Gmail. Emails written on a lead go out from that
person's inbox at the time they choose, in the lead's time zone. Every 5 minutes AgencyOS
syncs back into the CRM:

- emails you sent from Gmail itself, logged as a touch, and the lead moves to Contacted;
- replies, which move the lead to Replied and stop its scheduled follow-ups;
- "no" or "unsubscribe" replies, which also put the address on the never-contact list;
- bounces, which mark the address bad and stop its follow-ups;
- out-of-office replies, which are recorded but don't stop anything.

About 20 minutes of setup. You do steps 1–5 once; each team member does step 6.

## 1. Google Cloud: a Gmail app

Use a **new** Google Cloud project, so the Gmail permissions never touch your sign-in setup.

1. console.cloud.google.com → project picker → **New project** → name it `AgencyOS Mail` → Create.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Branding**):
   - User type: **External**. App name `AgencyOS`; support and developer email: yours.
   - **Data access / Scopes → Add scopes**: tick `.../auth/gmail.send` and `.../auth/gmail.readonly`, then Save.
   - **Audience**: add both Gmail addresses (yours and Abdullah's) as **test users**.
4. **Credentials → Create credentials → OAuth client ID** → **Web application**:
   - Authorized redirect URIs:
     - `https://YOUR-APP.vercel.app/auth/gmail/callback`
     - `http://localhost:3000/auth/gmail/callback`
   - Create, then copy the **Client ID** and **Client secret**.

**Testing or production?** In *Testing*, Google expires the connection every 7 days, so each
person clicks **Reconnect Gmail** once a week; the app shows when that's needed. To avoid
that, click **Publish app** on the Audience page and skip Google's verification. Personal use
under 100 people is allowed unverified: people see a "Google hasn't verified this app" screen
once (**Advanced → Go to AgencyOS**) and the connection then stays. If Google doesn't allow
publishing with these permissions, stay in Testing.

## 2. Secrets

Make three random values. In Command Prompt or PowerShell:

```bash
node -e "console.log('MAIL_TOKEN_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

```bash
node -e "console.log('MAILER_SECRET=' + require('crypto').randomBytes(36).toString('base64url'))"
```

```bash
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(36).toString('base64url'))"
```

| Variable | What it protects | Where it lives |
|---|---|---|
| `MAIL_TOKEN_KEY` | Encrypts each Gmail token before it's stored. Without it the stored tokens are useless | Vercel only |
| `MAILER_SECRET` | Lets the mail worker into the mail functions in the database, and nothing else | Vercel; the database keeps only its hash |
| `CRON_SECRET` | Lets the 5-minute timer trigger a run | Vercel and the cron job (step 4) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Gmail app from step 1 | Vercel only |

Vercel → your project → **Settings → Environment Variables**: add all five (Production), then
**Deployments → ⋯ → Redeploy**. For local testing, add the same lines to `web/.env.local`.

Don't change `MAIL_TOKEN_KEY` later: every connected inbox would then need reconnecting.

## 3. Database

Supabase → **SQL Editor → New query**: paste `supabase/migrations/0006_mail.sql` → **Run**.
Then, in a new query, store the worker secret (the database keeps only its SHA-256 hash):

```sql
select mailer_set_secret('PASTE-MAILER_SECRET-HERE');
```

## 4. The 5-minute timer

Supabase → **Database → Extensions**: enable **pg_cron** and **pg_net**. Then in the SQL Editor:

```sql
select cron.schedule('agencyos-mail', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/mail/tick',
    headers := jsonb_build_object('Authorization', 'Bearer PASTE-CRON_SECRET-HERE'),
    timeout_milliseconds := 60000
  );
$$);
```

To check it's running: `select * from cron.job_run_details order by start_time desc limit 5;`.
To stop it: `select cron.unschedule('agencyos-mail');`.

## 5. Turn sending on (owner)

AgencyOS → **Account → Gmail → Turn sending on**. Until then nothing is sent, but syncing works.
This is the kill switch: turning it off stops every send at once.

## 6. Each person: connect Gmail

1. **Account → Connect Gmail** → pick your Gmail → allow **both** permissions.
2. Fill in **Signature**: your name, agency, phone and **a real postal address**. The law
   requires the address in every email. The opt-out line ("Not interested? Reply "no"…")
   is added automatically.
3. Set **Max emails / day**: 20 to start, at most 40.

The first sync looks back 14 days, so emails you sent by hand before connecting, and any
replies to them, show up on the right leads.

## Writing and sending

- **Lead page → Email → Write an email**: pick the contact and the send time *in their time
  zone* (it suggests the next weekday at 7:45 AM), write it, and save. Ticked "Approve" means
  it's scheduled; unticked, it waits in your **Inbox → Waiting for your approval**.
- Follow-ups to the same person go as a reply in the same Gmail thread. A follow-up whose
  first email isn't synced yet is held back rather than sent as a fake "Re:".
- **Send now** sends straight away, still within the limits: sending on, a signature,
  your daily limit, and at least 2 minutes since your last send.
- Only the author can approve or edit an email, because it goes from their inbox.
  Anyone on the team can cancel one.
- **Inbox**: replies to handle, plus your emails waiting for approval and any failed ones.

### Loading prepared follow-ups

To load a prepared sequence (like `data/outreach/manus_ghl_sequences.md`) as emails waiting
for approval:

```bash
node scripts/import-sequences.mjs data/outreach/manus_ghl_sequences.md data/outreach/manus_plan.json --dry-run
```

Drop `--dry-run` to save. Then open each lead, check the emails, and click **Approve all**.

## What's protected, and how

- **Tokens:** Gmail tokens are encrypted with AES-256-GCM on the server and bound to their
  mailbox address. The key is never in the database or the browser, and the database
  table holding the tokens can't be read through the API at all.
- **Permissions:** AgencyOS can send and read mail only. It can't delete or change anything,
  and only messages to and from your leads are stored.
- **No master key on Vercel:** the worker uses the public anon key plus `MAILER_SECRET`,
  which only opens the mail functions. Team members write emails through functions that
  check who they are, so nobody can send from someone else's inbox.
- **Every send is re-checked:** never-contact list, do-not-contact, bounced address,
  consent basis (Canadian leads need a CASL basis), closed leads, the kill switch, the daily
  limit and the 2-minute gap. A send that never confirmed is marked failed, never retried
  blindly.
- **Revoking:** Disconnect revokes the access at Google too. You can also remove it at
  myaccount.google.com → Security → Third-party connections.
