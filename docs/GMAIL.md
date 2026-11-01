# Email: send from the CRM, sync replies back

Each team member connects their own inboxes: Gmail, and GoDaddy (or any IMAP/SMTP) email
such as moawiz@thesentinelsystems.com. Emails written on a lead go out from that
person's inbox at the time they choose, in the lead's time zone. Every 5 minutes AgencyOS
syncs back into the CRM:

- emails you sent from Gmail itself, logged as a touch, and the lead moves to Contacted;
- replies, which move the lead to Replied and stop its scheduled follow-ups;
- "no" or "unsubscribe" replies, which also put the address on the never-contact list;
- bounces, which mark the address bad and stop its follow-ups;
- out-of-office replies, which are recorded but don't stop anything.

About 20 minutes of setup. You do steps 1–5 once; each team member does step 6 (Gmail)
and/or step 7 (GoDaddy). GoDaddy-only? Skip step 1 and the two `GOOGLE_*` variables.

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

Optional sixth: `APP_URL` = your app's address (e.g. `https://agencyos.thesentinelsystems.com`). The Gmail
redirect then always uses it, whichever address you opened the app on.

Vercel → your project → **Settings → Environment Variables**: add all five (Production), then
**Deployments → ⋯ → Redeploy**. For local testing, add the same lines to `web/.env.local`.

Don't change `MAIL_TOKEN_KEY` later: every connected inbox would then need reconnecting.

## 3. Database

Supabase → **SQL Editor → New query**: paste `supabase/migrations/0006_mail.sql` → **Run**,
then the same with `supabase/migrations/0007_mail_inboxes.sql`. Then, in a new query, store the worker secret (the database keeps only its SHA-256 hash):

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

AgencyOS → **Account → Email inboxes → Turn sending on**. Until then nothing is sent, but syncing works.
This is the kill switch: turning it off stops every send at once.

## 6. Each person: connect Gmail

1. **Account → Email inboxes → Add Gmail inbox** → pick your Gmail → allow **both** permissions.
2. Open **Name, signature and daily limit** and fill in the **Signature**: your name, agency,
   phone and **a real postal address**. The law requires the address in every email. The
   opt-out line ("Not interested? Reply "no"…") is added automatically.
3. Set **Max emails / day**: 20 to start, at most 40.

The first sync looks back 14 days, so emails you sent by hand before connecting, and any
replies to them, show up on the right leads.

## 7. Each person: connect GoDaddy email

GoDaddy Professional Email has no Google-style sign-in, so AgencyOS logs in with the
mailbox password (IMAP to read, SMTP to send), the way Outlook or a phone mail app does.

1. GoDaddy → **My Products → Email** → set up the mailbox and give it a strong password
   used nowhere else. Log in once at **email.godaddy.com** to check it works.
2. AgencyOS → **Account → Email inboxes → Add GoDaddy email** → enter the address and password →
   **Test and connect**. GoDaddy sells two kinds of mailbox and AgencyOS tries both: newer
   ones run on **Titan** (webmail at `…titan.email`; `imap.titan.email:993`, `smtp.titan.email:465`),
   older ones on `imap.secureserver.net:993` / `smtpout.secureserver.net:465`. It logs in to
   check reading and sending before saving anything.
3. Fill in its **Signature** and **Max emails / day** (warming up: start at 5–10).
4. If you have more than one inbox, **Make default** the one new leads should come from.

If you change the mailbox password at GoDaddy, the inbox shows **Needs reconnecting**: add it
again with the new password. Every email you send from AgencyOS is also filed in the inbox's
**Sent** folder, so webmail shows the full conversation.

**Several inboxes:** each email can pick its inbox (**From** on the lead page). Left on
*Automatic*, a follow-up goes from the inbox that last emailed that person, so it stays in
the same thread, and anything else goes from your default. Example: the GHL leads emailed
from your personal Gmail keep getting their follow-ups from Gmail, while new leads go from
moawiz@thesentinelsystems.com.

**Before cold email from a new domain**, check its DNS at GoDaddy → **Domain → DNS**:
MX `mailstore1.secureserver.net` / `smtp.secureserver.net`, TXT `v=spf1 include:secureserver.net -all`
(on Titan mailboxes, make it `v=spf1 include:secureserver.net include:spf.titan.email -all`),
and add TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`. Send a test to
mail-tester.com (aim for 9/10; if DKIM fails, ask GoDaddy support to enable DKIM for
Professional Email), and warm the inbox up for 2–3 weeks before cold outreach.

**Check it:** Account → Email inboxes → **Setup check** shows whether each setting is in place, and the
exact Gmail redirect URI to register. It never shows secret values.

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

- **Passwords and tokens:** GoDaddy mailbox passwords and Gmail tokens are encrypted with AES-256-GCM on the server and bound to their
  mailbox address. The key is never in the database or the browser, and the database
  table holding the tokens can't be read through the API at all.
- **Permissions:** Gmail access is limited to sending and reading; it can't delete or change
  anything. A GoDaddy password can technically do everything in that mailbox, which is why it
  is encrypted, only decrypted in memory on the server for each run, and never sent back to the
  browser. AgencyOS itself only reads, sends, and files a copy of what it sends in Sent. Only
  messages to and from your leads are stored.
- **No master key on Vercel:** the worker uses the public anon key plus `MAILER_SECRET`,
  which only opens the mail functions. Team members write emails through functions that
  check who they are, so nobody can send from someone else's inbox.
- **Every send is re-checked:** never-contact list, do-not-contact, bounced address,
  consent basis (Canadian leads need a CASL basis), closed leads, the kill switch, the daily
  limit and the 2-minute gap. A send that never confirmed is marked failed, never retried
  blindly.
- **Revoking:** Disconnect revokes the access at Google too. You can also remove it at
  myaccount.google.com → Security → Third-party connections.
