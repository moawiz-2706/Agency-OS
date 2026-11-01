// Migration 0007: several inboxes per person (Gmail + GoDaddy/IMAP), the default inbox,
// and follow-ups staying in the inbox and thread where the first email went.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, USERS } from "./harness.mjs";

const { OWNER, PARTNER } = USERS;
const SECRET = "k".repeat(40);
const SIG = "Moawiz · Sentinel Systems · 123 Main St, Austin TX";
let db, as, rows, lead, contact, gmailId, godaddyId, partnerInbox;

const one = async (sql, params) => (await rows(sql, params))[0];
async function worker(sql, params) {
  await db.exec("set role anon");
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
}
const claim = async (acct) => (await worker(`select mailer_claim($1, $2) as m`, [SECRET, acct]))[0].m;
const backdate = () => db.query(`update mail_accounts set last_sent_at = now() - interval '10 minutes'`);
const imap = (email, host = "imap.secureserver.net") =>
  db.query(`select save_my_imap_account($1, 'Moawiz', 'v1.a.b.c', $2, 993, 'smtpout.secureserver.net', 465)`, [email, host]);

before(async () => {
  ({ db, as, rows } = await createDb());
  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner'), ($3, $4, 'Partner', 'partner')`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email]);
  lead = (await one(`insert into companies (name, country, source) values ('Swift Restoration', 'US', 'csv') returning id`)).id;
  contact = (await one(`insert into contacts (company_id, email, consent_basis) values ($1, 'darin@swift.test', 'can_spam_b2b') returning id`, [lead])).id;
  await db.query(`select mailer_set_secret($1)`, [SECRET]);
  await db.query(`insert into settings (key, value) values ('sending_enabled', 'true') on conflict (key) do update set value = 'true'`);
});

test("a member connects a Gmail and a GoDaddy inbox; the first is the default", async () => {
  await as(OWNER, async () => {
    await db.query(`select save_my_mail_account('owner@gmail.test', 'Moawiz', 'v1.x.y.z')`);
    await assert.rejects(imap("moawiz@sentinel.test", "imap.bad host"), /server names/);
    await imap("Moawiz@Sentinel.test");
    const mine = await rows(`select id, email, provider, is_default, connected from my_mail_accounts()`);
    assert.deepEqual(mine.map((m) => [m.email, m.provider, m.is_default, m.connected]),
      [["owner@gmail.test", "gmail", true, true], ["moawiz@sentinel.test", "imap", false, true]]);
    [gmailId, godaddyId] = mine.map((m) => m.id);
    for (const id of mine.map((m) => m.id)) await db.query(`select save_my_mail_settings($1, 'Moawiz', $2, 20)`, [id, SIG]);
  });
  const w = await worker(`select email, provider, imap_host, smtp_port, token from mailer_accounts($1)`, [SECRET]);
  assert.deepEqual(w.map((a) => [a.email, a.provider, a.imap_host, a.smtp_port]),
    [["owner@gmail.test", "gmail", null, null], ["moawiz@sentinel.test", "imap", "imap.secureserver.net", 465]]);
});

test("nobody can take another member's address, or send from another member's inbox", async () => {
  await as(PARTNER, async () => {
    await assert.rejects(imap("moawiz@sentinel.test"), /already connected/);
    await db.query(`select save_my_imap_account('masna@sentinel.test', 'Abdullah', 'v1.a.b.c', 'imap.secureserver.net', 993, 'smtpout.secureserver.net', 465)`);
    await assert.rejects(db.query(`select queue_email($1, $2, 's', 'b', null, true, $3)`, [lead, contact, gmailId]), /your own connected inbox/);
    await assert.rejects(db.query(`select set_default_mail_account($1)`, [gmailId]), /not found/);
    partnerInbox = (await one(`select id from my_mail_accounts()`)).id;
    // Team members see which inbox is whose, never the secrets.
    assert.equal((await rows(`select * from team_inboxes()`)).length, 3);
  });
});

test("an email naming an inbox goes from that inbox only", async () => {
  const id = await as(OWNER, async () => (await one(`select queue_email($1, $2, 'Two numbers', 'Hi Darin', null, true, $3) as id`, [lead, contact, godaddyId])).id);
  assert.equal(await claim(gmailId), null);
  const m = await claim(godaddyId);
  assert.equal(m.id, id);
  assert.equal(m.from_email, "moawiz@sentinel.test");
  await worker(`select mailer_result($1, $2, true, 'rfc:<a1@sentinel.test>', 'rfc:<a1@sentinel.test>', '<a1@sentinel.test>', null)`, [SECRET, id]);
});

test("a follow-up with no inbox named stays in the inbox and thread of the first email", async () => {
  // Imported follow-ups have no inbox: Gmail is the default, but Darin was emailed from GoDaddy.
  const id = (await one(`insert into outreach_messages (company_id, contact_id, member_id, step, subject, body, status, scheduled_for, source)
    values ($1, $2, (select id from team_members where role = 'owner'), 2, 'Re: Two numbers', 'Quick idea', 'approved', now(), 'import') returning id`, [lead, contact])).id;
  await backdate();
  assert.equal(await claim(gmailId), null);
  const m = await claim(godaddyId);
  assert.equal(m.id, id);
  assert.equal(m.thread_id, "rfc:<a1@sentinel.test>");
  assert.equal(m.in_reply_to, "<a1@sentinel.test>");
  assert.equal(m.subject, "Re: Two numbers");
  await worker(`select mailer_result($1, $2, true, 'rfc:<a2@sentinel.test>', $3, '<a2@sentinel.test>', null)`, [SECRET, id, m.thread_id]);
});

test("changing the default, and disconnecting moves the default to another inbox", async () => {
  await as(OWNER, async () => {
    await db.query(`select set_default_mail_account($1)`, [godaddyId]);
    assert.deepEqual((await rows(`select email from my_mail_accounts() where is_default`)).map((r) => r.email), ["moawiz@sentinel.test"]);
    await db.query(`select disconnect_my_mail_account($1)`, [godaddyId]);
    const mine = await rows(`select email, is_default from my_mail_accounts()`);
    assert.deepEqual(mine.map((m) => [m.email, m.is_default]), [["owner@gmail.test", true]]);
  });
  // Its emails now fall back to the remaining inbox, where the thread doesn't exist: held, never a fake "Re:".
  const id = (await one(`insert into outreach_messages (company_id, contact_id, member_id, step, subject, body, status, scheduled_for, source)
    values ($1, $2, (select id from team_members where role = 'owner'), 3, 'Re: Two numbers', 'Another idea', 'approved', now(), 'import') returning id`, [lead, contact])).id;
  await backdate();
  assert.equal(await claim(gmailId), null);
  const m = await one(`select status, error from outreach_messages where id = $1`, [id]);
  assert.equal(m.status, "failed");
  assert.match(m.error, /isn't synced from owner@gmail\.test/);
  assert.equal(await claim(partnerInbox), null, "never from someone else's inbox");
});
