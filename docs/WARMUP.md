# Warming up the GoDaddy mailboxes (moawiz@ and masna@thesentinelsystems.com)

A brand-new domain has no sending history. Mail providers (Gmail, Outlook, Yahoo) don't trust it yet, so
cold emails from it land in spam. Getting that wrong early is hard to undo. **Warm-up** means 3–4 weeks of
small, normal, two-way email so the domain earns a good reputation before any cold outreach.

Until then, cold outreach goes from the personal Gmails (as it does now).

## Where things stand (checked 4 Nov 2026)

| Check | Status |
|---|---|
| MX (where mail is delivered) | ✅ GoDaddy (`smtp.secureserver.net`) |
| SPF (who may send for the domain) | ✅ `v=spf1 include:secureserver.net -all` |
| DMARC (what to do with fakes) | ✅ `p=quarantine` |
| DKIM (signature proving mail is really yours) | ❌ none found: see step 2 |
| moawiz@ | Connected, limit 5/day ✅ |
| masna@ | **Disconnected**: the password was rejected (step 1) |

## Step 1: reconnect masna@ (Abdullah, 2 minutes)
1. Check the password works at GoDaddy webmail first.
2. In the app: **Account → Email inboxes** → under masna@, **Disconnect**.
3. **Add a GoDaddy inbox** → enter masna@thesentinelsystems.com and the current password → **Connect**.
4. Open **Name, signature and daily limit** → set **Max emails / day = 5** → Save.

## Step 2: turn on DKIM
1. Sign in to **godaddy.com** → **My Products** → **Email & Office** (or *Professional Email*) → **Manage** next to thesentinelsystems.com.
2. Look for **Email authentication / DKIM** (sometimes under *Settings* or *Advanced*). If there's a switch or an "Add record" button, turn it on. GoDaddy adds the DNS record itself when the domain's DNS is at GoDaddy.
3. Wait 1 hour, then do the test in step 3. If the test still says "no DKIM", contact GoDaddy support and ask: *"Please enable DKIM signing for thesentinelsystems.com on my email plan."*

## Step 3: test a real email (mail-tester.com, free)
1. Open **https://www.mail-tester.com**. It shows a one-off address like `test-abc123@srv1.mail-tester.com`.
2. From **moawiz@** webmail, send a normal-looking email to that address: a real subject, a few sentences, and your signature.
3. Click **Then check your score** on the site. Aim for **9/10 or better**. It lists anything to fix (SPF, DKIM, DMARC, blacklists, content).
4. Repeat for **masna@**.

## Step 4: (optional) Google Postmaster Tools, to watch your reputation
1. Go to **https://postmaster.google.com** with your Google account → **+** → enter `thesentinelsystems.com`.
2. It gives you a TXT record. In GoDaddy → **Domains → DNS → Add record → TXT**, Name `@`, paste the value, then save and click **Verify**.
3. After a couple of weeks of sending, it shows how Gmail rates the domain (spam rate, reputation).

## Step 5: the warm-up itself (3–4 weeks)

Send **real emails that get replies**. Each mailbox:

| Week | Emails a day | Who to |
|---|---|---|
| 1 | 3–5 | Each other (moawiz@ ↔ masna@), your personal Gmails, friends and family. Ask them to **reply**. |
| 2 | 5–10 | The same, plus people you already work with: suppliers, existing contacts, newsletter sign-ups. |
| 3 | 10–15 | Keep the conversations going; start replying to inbound leads from these mailboxes. |
| 4 | 15–20 | Start **small cold batches** (5 a day, then 10) from the CRM; keep the rest of the volume normal. |

Tips that make warm-up work:
- **Replies matter most.** A conversation of 3–4 emails back and forth beats 20 one-way emails.
- If a warm-up email lands in **spam**, open it, click **Not spam** and **reply**. That teaches the provider.
- Weeks 1–2: no links, no images, no attachments. A plain signature with your postal address.
- Don't send the same text to many people.
- Spread sends across the day; don't send 10 within a minute.

**Want it automatic instead?** Warm-up services (for example **Instantly**, **Lemwarm**, **MailReach** or
**Warmup Inbox**, roughly $15–30 a month per mailbox) connect to the mailbox and swap emails with their
network every day. Connect them with:
- **IMAP:** `imap.secureserver.net`, port `993`, SSL
- **SMTP:** `smtpout.secureserver.net`, port `465`, SSL
- **Username:** the full email address

Turn on a slow ramp (start at 5 a day) and leave it running for at least 3 weeks. You can keep it running
at a low level after you start cold outreach.

## Step 6: when you're ready for cold outreach from the domain
- mail-tester score of **9/10 or better** on both mailboxes;
- at least **3 weeks** of warm-up with replies;
- in the app, keep **Max emails / day** at **10** for the first cold week, then 15, then 20 (never over 30);
- keep bounces under 3% (the app pauses sending by itself above that; see the Reports page);
- for the first weeks, mix in the personal Gmails rather than moving everything to the domain at once.
