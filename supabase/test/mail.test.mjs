// Migration 0006: connect an inbox, queue/approve emails, the worker's claim/result
// cycle, and Gmail sync (manual sends, replies, opt-outs, bounces, out-of-office).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, migrationSql, USERS } from "./harness.mjs";

const { OWNER, PARTNER } = USERS;
const SECRET = "s".repeat(40);
const TOKEN = "v1.iv.tag.ciphertext";
let db, as, rows;
let lead, lead2, contact, contact2, ownerId, account;

const one = async (sql, params) => (await rows(sql, params))[0];
/** Call a worker function the way the Vercel route does: anon role, no user. */
async function worker(sql, params) {
  await db.exec("set role anon");
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
}
const claim = async () => (await worker(`select mailer_claim($1, $2) as m`, [SECRET, account]))[0].m;
const backdateLastSend = () => db.query(`update mail_accounts set last_sent_at = now() - interval '10 minutes'`);

before(async () => {
  ({ db, as, rows } = await createDb());
  await db.exec(migrationSql("0006_mail.sql"));   // safe to re-run
  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner'), ($3, $4, 'Partner', 'partner')`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email]);
  ownerId = (await one(`select id from team_members where role = 'owner'`)).id;
  [lead, lead2] = (await rows(`insert into companies (name, country, source) values ('Swift Restoration', 'US', 'csv'), ('BAR T Electric', 'US', 'csv') returning id`)).map((r) => r.id);
  contact = (await one(`insert into contacts (company_id, email, full_name, consent_basis) values ($1, 'darin@swift.test', 'Darin', 'can_spam_b2b') returning id`, [lead])).id;
  contact2 = (await one(`insert into contacts (company_id, email, consent_basis) values ($1, 'bar-t@tct.test', 'can_spam_b2b') returning id`, [lead2])).id;
  await db.query(`select mailer_set_secret($1)`, [SECRET]);
});

test("the worker functions refuse a wrong secret, and nobody reads mail_accounts directly", async () => {
  await assert.rejects(worker(`select * from mailer_accounts($1)`, ["x".repeat(40)]), /not authorised/);
  await assert.rejects(worker(`select mailer_claim($1, gen_random_uuid())`, ["short"]), /not authorised/);
  await assert.rejects(as(OWNER, () => db.query(`select * from mail_accounts`)), /permission denied/);
  await assert.rejects(worker(`select * from mailer_config`), /permission denied/);
});

test("a member connects their inbox and sets the signature; the token stays hidden", async () => {
  await as(OWNER, async () => {
    await db.query(`select save_my_mail_account('Owner@Gmail.test', 'Moawiz', $1)`, [TOKEN]);
    await assert.rejects(db.query(`select save_my_mail_settings('Moawiz', 'too short', 20)`), /postal address/);
    await db.query(`select save_my_mail_settings('Moawiz', 'Moawiz · Agency · 123 Main St, Austin TX', 99)`);
    const me = await one(`select * from my_mail_account()`);
    assert.equal(me.email, "owner@gmail.test");
    assert.equal(me.connected, true);
    assert.equal(me.daily_limit, 40);        // capped
    assert.equal(me.sending_enabled, false); // kill switch starts off
    assert.equal("token" in me, false);
  });
  await as(PARTNER, async () => {
    await assert.rejects(db.query(`select save_my_mail_account('owner@gmail.test', 'X', $1)`, [TOKEN]), /already connected/);
  });
  account = (await one(`select id from mail_accounts`)).id;
  const [w] = await worker(`select * from mailer_accounts($1)`, [SECRET]);
  assert.equal(w.token, TOKEN);
});

test("queue and approve: only the author approves, and nothing sends while the kill switch is off", async () => {
  const id = await as(OWNER, async () => (await one(`select queue_email($1, $2, 'Two numbers on your homepage', 'Hi Darin, ...', now() - interval '1 minute') as id`, [lead, contact])).id);
  assert.equal((await one(`select status, step, member_id from outreach_messages where id = $1`, [id])).status, "pending_approval");
  await as(PARTNER, async () => {
    await assert.rejects(db.query(`select approve_email($1)`, [id]), /only its author/);
    await assert.rejects(db.query(`select set_sending_enabled(true)`), /only an owner/);
    await assert.rejects(db.query(`select queue_email($1, $2, 's', 'b')`, [lead2, contact]), /not on this lead/);
  });
  await as(OWNER, () => db.query(`select approve_email($1)`, [id]));
  assert.equal(await claim(), null, "sending disabled");
  await as(OWNER, () => db.query(`select set_sending_enabled(true)`));

  const m = await claim();
  assert.equal(m.id, id);
  assert.equal(m.to, "darin@swift.test");
  assert.equal(m.thread_id, null);
  assert.equal(m.from_email, "owner@gmail.test");
  assert.match(m.signature, /Austin/);
  assert.equal((await one(`select status from outreach_messages where id = $1`, [id])).status, "queued");

  await worker(`select mailer_result($1, $2, true, 'g-1', 't-1', '<m1@mail.gmail.com>', null)`, [SECRET, id]);
  const sent = await one(`select status, gmail_message_id, thread_id, sent_at from outreach_messages where id = $1`, [id]);
  assert.deepEqual([sent.status, sent.gmail_message_id, sent.thread_id], ["sent", "g-1", "t-1"]);
  const co = await one(`select stage, touches_count from companies where id = $1`, [lead]);
  assert.deepEqual([co.stage, co.touches_count], ["contacted", 1]);
  const t = await one(`select member_id, channel, outcome from touches where company_id = $1`, [lead]);
  assert.deepEqual([t.member_id, t.channel, t.outcome], [ownerId, "email", "sent"]);
});

test("follow-ups wait 2 minutes between sends and go out as a reply in the same thread", async () => {
  const id = await as(OWNER, async () => (await one(`select queue_email($1, $2, 'ignored for a follow-up', 'Quick idea...', null, true) as id`, [lead, contact])).id);
  assert.equal((await one(`select step from outreach_messages where id = $1`, [id])).step, 2);
  assert.equal(await claim(), null, "sent less than 2 minutes ago");
  await backdateLastSend();
  const m = await claim();
  assert.equal(m.id, id);
  assert.equal(m.thread_id, "t-1");
  assert.equal(m.subject, "Re: Two numbers on your homepage");
  assert.equal(m.in_reply_to, "<m1@mail.gmail.com>");
  await worker(`select mailer_result($1, $2, false, null, null, null, 'Gmail said no')`, [SECRET, id]);
  const f = await one(`select status, error from outreach_messages where id = $1`, [id]);
  assert.deepEqual([f.status, f.error], ["failed", "Gmail said no"]);
  await as(OWNER, () => db.query(`select cancel_email($1)`, [id]));
});

test("a blocked contact is never sent to, even if it was approved earlier", async () => {
  const id = await as(OWNER, async () => (await one(`select queue_email($1, $2, 'Hello', 'Hi', null, true) as id`, [lead2, contact2])).id);
  await db.query(`insert into suppressions (email, reason) values ('bar-t@tct.test', 'asked_not_to')`);
  await backdateLastSend();
  assert.equal(await claim(), null);
  const m = await one(`select status, error from outreach_messages where id = $1`, [id]);
  assert.equal(m.status, "cancelled");
  assert.match(m.error, /never-contact/);
  await as(OWNER, async () => {
    await assert.rejects(db.query(`select queue_email($1, $2, 's', 'b')`, [lead2, contact2]), /never-contact/);
  });
  await db.query(`delete from suppressions`);
});

test("sync: mailer_match picks only messages about leads, then manual sends and replies are recorded", async () => {
  const msgs = [
    { id: "g-x", thread_id: "t-x", from: "friend@example.test", to: ["owner@gmail.test"] },
    { id: "g-2", thread_id: "t-2", from: "owner@gmail.test", to: ["bar-t@tct.test"] },
    { id: "g-1", thread_id: "t-1", from: "owner@gmail.test", to: ["darin@swift.test"] },   // already stored
    { id: "g-3", thread_id: "t-1", from: "x@other.test", to: ["owner@gmail.test"] },       // known thread
  ];
  const [{ ids }] = await worker(`select mailer_match($1, $2, $3) as ids`, [SECRET, account, JSON.stringify(msgs)]);
  assert.deepEqual([...ids].sort(), ["g-2", "g-3"]);

  // A follow-up waiting for Darin, written before his reply arrives.
  const pending = await as(OWNER, async () => (await one(`select queue_email($1, $2, 's', 'Follow-up', now() + interval '2 days', true) as id`, [lead, contact])).id);

  const res = (await worker(`select mailer_sync_save($1, $2, $3, now()) as r`, [SECRET, account, JSON.stringify([
    { id: "g-2", thread_id: "t-2", kind: "sent", from: "owner@gmail.test", to: ["BAR-T@tct.test"], subject: "Two phone numbers", body: "Hi Jonathon", date: "2026-11-04T14:45:00Z", rfc_id: "<m2@x>" },
    { id: "g-4", thread_id: "t-1", kind: "auto_reply", from: "darin@swift.test", subject: "Out of office", body: "Back Monday", date: "2026-11-05T09:00:00Z" },
    { id: "g-5", thread_id: "t-1", kind: "reply", from: "Darin@Swift.test", subject: "Re: Two numbers", snippet: "Thanks, can you call me?", body: "Thanks, can you call me?", date: new Date().toISOString(), rfc_id: "<r1@x>" },
  ])]))[0].r;
  assert.deepEqual(res, { sent: 1, replies: 1, bounces: 0, auto_replies: 1, unsubscribes: 0, skipped: 0 });

  const manual = await one(`select status, source, step, member_id, mail_account_id from outreach_messages where gmail_message_id = 'g-2'`);
  assert.deepEqual([manual.status, manual.source, manual.step, manual.member_id], ["sent", "gmail", 1, ownerId]);
  assert.equal((await one(`select stage from companies where id = $1`, [lead2])).stage, "contacted");

  assert.equal((await one(`select stage from companies where id = $1`, [lead])).stage, "replied");
  const p = await one(`select status, error from outreach_messages where id = $1`, [pending]);
  assert.deepEqual([p.status, p.error], ["cancelled", "stopped: they replied"]);
  const inbound = await rows(`select gmail_message_id, classification, handled from inbound_messages order by gmail_message_id`);
  assert.deepEqual(inbound.map((i) => [i.gmail_message_id, i.classification, i.handled]), [["g-4", "out_of_office", true], ["g-5", null, false]]);
  const thread = await one(`select unread, handled, company_id from email_threads where thread_id = 't-1'`);
  assert.deepEqual([thread.unread, thread.handled, thread.company_id], [true, false, lead]);

  // Re-syncing the same messages changes nothing.
  const again = (await worker(`select mailer_sync_save($1, $2, $3, now()) as r`, [SECRET, account, JSON.stringify([{ id: "g-5", thread_id: "t-1", kind: "reply", from: "darin@swift.test" }])]))[0].r;
  assert.equal(again.replies, 0);

  // The team can read replies and mark them handled, but not write mail tables directly.
  await as(PARTNER, async () => {
    const [r] = await rows(`select id from inbound_messages where gmail_message_id = 'g-5'`);
    await db.query(`select mark_reply_handled($1)`, [r.id]);
    await assert.rejects(db.query(`update outreach_messages set status = 'sent'`), /permission denied/);
  });
  assert.equal((await one(`select handled from email_threads where thread_id = 't-1'`)).handled, true);
});

test("sync: an opt-out reply suppresses the contact; a bounce marks the email bad", async () => {
  await worker(`select mailer_sync_save($1, $2, $3, now())`, [SECRET, account, JSON.stringify([
    { id: "g-6", thread_id: "t-2", kind: "reply", from: "bar-t@tct.test", subject: "Re: Two phone numbers", body: "no", unsubscribe: true, date: new Date().toISOString() },
  ])]);
  const c2 = await one(`select do_not_contact from contacts where id = $1`, [contact2]);
  assert.equal(c2.do_not_contact, true);
  assert.equal((await one(`select count(*)::int as n from suppressions where email = 'bar-t@tct.test'`)).n, 1);

  const c3 = (await one(`insert into contacts (company_id, email, consent_basis) values ($1, 'old@swift.test', 'can_spam_b2b') returning id`, [lead])).id;
  await worker(`select mailer_sync_save($1, $2, $3, now())`, [SECRET, account, JSON.stringify([
    { id: "g-7", thread_id: "t-7", kind: "sent", from: "owner@gmail.test", to: ["old@swift.test"], subject: "Hello", date: new Date(Date.now() - 60000).toISOString() },
    { id: "g-8", thread_id: "t-7", kind: "bounce", from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", date: new Date().toISOString() },
  ])]);
  assert.equal((await one(`select email_status from contacts where id = $1`, [c3])).email_status, "bounced");
  await as(OWNER, async () => {
    await assert.rejects(db.query(`select queue_email($1, $2, 's', 'b')`, [lead, c3]), /bounced/);
  });
});

test("a follow-up is never sent as a fake 'Re:' when its first email isn't synced", async () => {
  const c4 = (await one(`insert into contacts (company_id, email, consent_basis) values ($1, 'new@swift.test', 'can_spam_b2b') returning id`, [lead])).id;
  const id = await as(OWNER, async () => (await one(`select queue_email($1, $2, 'Re: Two numbers', 'Following up', null, true) as id`, [lead, c4])).id);
  await backdateLastSend();
  assert.equal(await claim(), null);
  const m = await one(`select status, error from outreach_messages where id = $1`, [id]);
  assert.equal(m.status, "failed");
  assert.match(m.error, /isn't synced/);
});

test("a send that never reported back is marked failed, not retried", async () => {
  const id = await as(OWNER, async () => (await one(`select queue_email($1, $2, 'Hi', 'Body', null, true) as id`, [lead, contact])).id);
  await db.query(`update outreach_messages set status = 'queued', updated_at = now() - interval '20 minutes' where id = $1`, [id]);
  await db.exec(`alter table outreach_messages disable trigger outreach_messages_updated_at`);
  await db.query(`update outreach_messages set updated_at = now() - interval '20 minutes' where id = $1`, [id]);
  await db.exec(`alter table outreach_messages enable trigger outreach_messages_updated_at`);
  await claim();
  const m = await one(`select status, error from outreach_messages where id = $1`, [id]);
  assert.equal(m.status, "failed");
  assert.match(m.error, /Sent folder/);
});
