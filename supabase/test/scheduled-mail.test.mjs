// Migration 0009: "Schedule send" from the Mailbox.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, USERS } from "./harness.mjs";

const { OWNER, PARTNER } = USERS;
const SECRET = "s".repeat(40);
let db, as, rows, inbox;
const one = async (sql, params) => (await rows(sql, params))[0];
async function worker(sql, params) {
  await db.exec("set role anon");
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
}
const claim = async () => (await worker(`select mailer_claim_scheduled($1, $2) as m`, [SECRET, inbox]))[0].m;
const schedule = (at, to = ["darin@swift.test"]) =>
  db.query(`select schedule_my_mail($1, $2, '{}', '{}', 'Quote', 'Hi Darin', null, null, ${at}) as id`, [inbox, to]);

before(async () => {
  ({ db, as, rows } = await createDb());
  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner'), ($3, $4, 'Partner', 'partner')`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email]);
  await db.query(`select mailer_set_secret($1)`, [SECRET]);
  await as(OWNER, () => db.query(`select save_my_imap_account('moawiz@sentinel.test', 'Moawiz', 'v1.a.b.c', 'imap.secureserver.net', 993, 'smtpout.secureserver.net', 465)`));
  inbox = (await one(`select id from mail_accounts`)).id;
});

test("only the inbox's owner schedules from it, for a future time", async () => {
  await as(PARTNER, () => assert.rejects(schedule("now() + interval '1 hour'"), /your own connected inbox/));
  await as(OWNER, async () => {
    await assert.rejects(schedule("now() - interval '1 hour'"), /in the future/);
    await assert.rejects(schedule("now() + interval '1 hour'", []), /at least one address/);
    await schedule("now() + interval '1 hour'");
    assert.equal((await rows(`select * from my_scheduled_mail($1)`, [inbox])).length, 1);
  });
  await as(PARTNER, async () => assert.equal((await rows(`select * from my_scheduled_mail($1)`, [inbox])).length, 0));
  // Not readable through the API directly.
  await as(OWNER, async () => assert.rejects(rows(`select * from scheduled_mail`), /permission denied/));
});

test("the worker sends it once it's due, ignores the team switch, and re-checks the never-contact list", async () => {
  assert.equal(await claim(), null, "not due yet");
  await db.query(`update scheduled_mail set send_at = now() - interval '1 minute'`);
  const m = await claim();
  assert.deepEqual([m.to, m.subject, m.body], [["darin@swift.test"], "Quote", "Hi Darin"]);
  assert.equal(await claim(), null, "claimed once");
  await worker(`select mailer_scheduled_result($1, $2, true, null)`, [SECRET, m.id]);
  assert.equal((await one(`select status from scheduled_mail where id = $1`, [m.id])).status, "sent");

  await as(OWNER, () => schedule("now() + interval '2 minutes'", ["ops@blocked.test"]));
  await db.query(`insert into suppressions (domain, reason) values ('blocked.test', 'asked_not_to')`);
  await db.query(`update scheduled_mail set send_at = now() - interval '1 minute' where status = 'scheduled'`);
  assert.equal(await claim(), null);
  assert.match((await one(`select error from scheduled_mail where status = 'failed'`)).error, /ops@blocked\.test is now on the never-contact list/);
});

test("cancelling: only your own, only while it's waiting", async () => {
  const id = (await as(OWNER, () => schedule("now() + interval '1 day'"))).rows[0].id;
  await as(PARTNER, () => assert.rejects(db.query(`select cancel_my_scheduled_mail($1)`, [id]), /isn't waiting/));
  await as(OWNER, () => db.query(`select cancel_my_scheduled_mail($1)`, [id]));
  assert.equal((await one(`select status from scheduled_mail where id = $1`, [id])).status, "cancelled");
  await as(OWNER, () => assert.rejects(db.query(`select cancel_my_scheduled_mail($1)`, [id]), /isn't waiting/));
});
