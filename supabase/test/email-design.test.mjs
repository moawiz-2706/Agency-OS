// Migration 0014: the team's email design (Templates page), read by the mail worker.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, USERS, migrationFiles, migrationSql } from "./harness.mjs";

const { OWNER, PARTNER } = USERS;
const SECRET = "d".repeat(40);
let db, as, rows;
const one = async (sql, params) => (await rows(sql, params))[0];
const design = (user) => as(user, () => one(`select email_design() as d`)).then((r) => r.d);

before(async () => {
  ({ db, as, rows } = await createDb());
  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner'), ($3, $4, 'Partner', 'partner')`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email]);
  await db.query(`select mailer_set_secret($1)`, [SECRET]);
});

test("there's a sensible default the team can read", async () => {
  assert.deepEqual(await design(PARTNER), { style: "personal", accent: "#1d4ed8", sign_off: "Best regards,", font: "sans" });
});

test("only an owner changes it, and odd values are refused", async () => {
  await as(PARTNER, () => assert.rejects(db.query(`select set_email_design('{"style":"plain"}')`), /only an owner/));
  await as(OWNER, () => assert.rejects(db.query(`select set_email_design('{"style":"flashy"}')`), /unknown email style/));
  await as(OWNER, () => assert.rejects(db.query(`select set_email_design('{"accent":"red;}"}')`), /accent colour/));
  await as(OWNER, () => db.query(`select set_email_design('{"style":"branded","accent":"#0F766E","sign_off":"Thanks,\\nM","font":"serif","extra":1}')`));
  assert.deepEqual(await design(PARTNER), { style: "branded", accent: "#0f766e", sign_off: "Thanks, M", font: "serif" });
});

test("the worker reads it only with the mailer secret", async () => {
  assert.equal((await one(`select mailer_email_design($1) as d`, [SECRET])).d.style, "branded");
  await assert.rejects(db.query(`select mailer_email_design($1)`, ["x".repeat(40)]), /not authorised/);
});

test("re-running the migration keeps the saved design", async () => {
  await db.exec(migrationSql(migrationFiles().find((f) => f.startsWith("0014"))));
  assert.equal((await design(OWNER)).style, "branded");
});
