// Migration 0013: BCC a copy of every outreach email from an inbox.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, USERS } from "./harness.mjs";

const { OWNER, PARTNER } = USERS;
const SECRET = "b".repeat(40);
let db, as, rows, inbox;
const one = async (sql, params) => (await rows(sql, params))[0];

before(async () => {
  ({ db, as, rows } = await createDb());
  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner'), ($3, $4, 'Partner', 'partner')`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email]);
  await db.query(`select mailer_set_secret($1)`, [SECRET]);
  await as(OWNER, () => db.query(`select save_my_mail_account('owner@gmail.test', 'Moawiz', 'v1.x.y.z')`));
  inbox = (await one(`select id from mail_accounts`)).id;
});

test("only the inbox owner sets the BCC address; the worker sees it", async () => {
  await as(PARTNER, () => assert.rejects(db.query(`select set_my_inbox_bcc($1, 'p@x.test')`, [inbox]), /inbox not found/));
  await as(OWNER, async () => {
    await assert.rejects(db.query(`select set_my_inbox_bcc($1, 'not an email')`, [inbox]), /isn't valid/);
    await db.query(`select set_my_inbox_bcc($1, ' Abdullah@Partner.test ')`, [inbox]);
    assert.deepEqual(await rows(`select bcc_email from my_inbox_bcc()`), [{ bcc_email: "abdullah@partner.test" }]);
  });
  await db.exec("set role anon");
  try {
    const w = (await db.query(`select email, bcc_email from mailer_accounts($1)`, [SECRET])).rows;
    assert.deepEqual(w, [{ email: "owner@gmail.test", bcc_email: "abdullah@partner.test" }]);
  } finally { await db.exec("reset role"); }
  await as(OWNER, () => db.query(`select set_my_inbox_bcc($1, '')`, [inbox]));
  assert.equal((await one(`select bcc_email from mail_accounts`)).bcc_email, null);
});
