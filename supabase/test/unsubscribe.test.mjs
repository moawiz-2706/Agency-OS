// Migration 0008: one-click unsubscribe, and sending pausing itself when bounces spike.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, USERS } from "./harness.mjs";

const { OWNER } = USERS;
const SECRET = "u".repeat(40);
let db, as, rows, lead, contact;
const one = async (sql, params) => (await rows(sql, params))[0];
async function worker(sql, params) {
  await db.exec("set role anon");
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
}
const sending = async () => (await one(`select sending_enabled() as on`)).on;

before(async () => {
  ({ db, as, rows } = await createDb());
  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner')`, [OWNER.sub, OWNER.email]);
  lead = (await one(`insert into companies (name, country, source) values ('Swift Restoration', 'US', 'csv') returning id`)).id;
  contact = (await one(`insert into contacts (company_id, email, consent_basis) values ($1, 'Darin@Swift.test', 'can_spam_b2b') returning id`, [lead])).id;
  await db.query(`select mailer_set_secret($1)`, [SECRET]);
});

test("an unsubscribe link needs the worker secret, then stops everything to that address", async () => {
  await as(OWNER, () => db.query(`select queue_email($1, $2, 'Hi', 'Body', now() + interval '1 day', true, null)`, [lead, contact]));
  await assert.rejects(worker(`select mailer_unsubscribe($1, 'darin@swift.test')`, ["wrong".repeat(10)]), /not authorised/);
  assert.equal((await worker(`select mailer_unsubscribe($1, ' DARIN@swift.test ') as n`, [SECRET]))[0].n, 1);
  assert.equal((await one(`select do_not_contact from contacts where id = $1`, [contact])).do_not_contact, true);
  assert.equal((await one(`select count(*)::int n from suppressions where email = 'darin@swift.test' and reason = 'unsubscribed'`)).n, 1);
  assert.deepEqual(await rows(`select status, error from outreach_messages`), [{ status: "cancelled", error: "stopped: they unsubscribed" }]);
  // Clicking twice is fine.
  await worker(`select mailer_unsubscribe($1, 'darin@swift.test')`, [SECRET]);
  assert.equal((await one(`select count(*)::int n from suppressions`)).n, 1);
});

test("two bounces over 3% of the day's sends switch sending off, with the reason; turning it on clears it", async () => {
  await as(OWNER, () => db.query(`select set_sending_enabled(true)`));
  const bounce = () => db.query(`insert into inbound_messages (gmail_message_id, from_email, classification, received_at, handled) values (gen_random_uuid()::text, 'mailer-daemon@x.test', 'bounce', now(), true)`);
  await bounce();
  assert.equal(await sending(), true, "one bounce is not a spike");
  // 2 bounces out of 100 sent = 2%: still fine.
  const other = (await one(`insert into contacts (company_id, email, consent_basis) values ($1, 'ops@swift.test', 'can_spam_b2b') returning id`, [lead])).id;
  for (let i = 0; i < 100; i++) {
    await db.query(`insert into outreach_messages (company_id, contact_id, subject, body, status, sent_at) values ($1, $2, 's', 'b', 'sent', now())`, [lead, other]);
  }
  await bounce();
  assert.equal(await sending(), true);
  await db.query(`delete from outreach_messages where status = 'sent' and id in (select id from outreach_messages where status = 'sent' limit 95)`);
  await bounce();   // 3 of 5
  assert.equal(await sending(), false);
  const info = await as(OWNER, () => one(`select sending_pause_info() as i`));
  assert.match(info.i.reason, /^3 emails bounced in the last 24 hours \(5 sent\)/);
  await as(OWNER, () => db.query(`select set_sending_enabled(true)`));
  assert.equal(await sending(), true);
  assert.equal((await as(OWNER, () => one(`select sending_pause_info() as i`))).i, null);
});
