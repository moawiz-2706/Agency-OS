// Migration 0005: first-time sign-ins wait for the owner's approval.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, migrationSql } from "./harness.mjs";

let db, as, rows;
const OWNER = { sub: "00000000-0000-0000-0000-0000000000a1", email: "owner@agency.test" };
const STRANGER = { sub: "00000000-0000-0000-0000-0000000000b2", email: "Stranger@Gmail.test" };
const INVITED = { sub: "00000000-0000-0000-0000-0000000000c3", email: "invited@gmail.test" };

const signUp = (u, name) => db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
  [u.sub, u.email, JSON.stringify(name ? { full_name: name } : {})]);
const status = (u) => as(u, async () => (await rows(`select my_member_status() as s`))[0].s);

before(async () => {
  ({ db, as, rows } = await createDb());
  await db.exec(migrationSql("0005_signup_approval.sql"));   // safe to re-run
  await signUp(OWNER);
  await db.query(`update team_members set role = 'owner', active = true where email = $1`, [OWNER.email]);
  await db.query(`insert into companies (name, country, source) values ('Acme HVAC', 'US', 'csv')`);
});

test("a first-time sign-in becomes a pending member and sees no data", async () => {
  await signUp(STRANGER, "Sam Stranger");
  const [m] = await rows(`select email, full_name, role, active, user_id from team_members where email = 'stranger@gmail.test'`);
  assert.deepEqual([m.email, m.full_name, m.role, m.active, m.user_id], ["stranger@gmail.test", "Sam Stranger", "partner", false, STRANGER.sub]);
  assert.equal(await status(STRANGER), "pending");
  await as(STRANGER, async () => {
    assert.equal((await rows(`select id from companies`)).length, 0);
    assert.equal((await rows(`select id from team_members`)).length, 0);
    await assert.rejects(db.query(`update team_members set active = true where email = 'stranger@gmail.test'`).then((r) => {
      if (!r.affectedRows) throw new Error("no rows updated");   // RLS: a pending member can't approve themself
    }));
  });
});

test("after the owner sets active = true, they see the CRM", async () => {
  await db.query(`update team_members set active = true where email = 'stranger@gmail.test'`);
  assert.equal(await status(STRANGER), "active");
  await as(STRANGER, async () => assert.equal((await rows(`select id from companies`)).length, 1));
});

test("someone added in advance is linked on first sign-in and keeps their access", async () => {
  await db.query(`insert into team_members (email, full_name, role, active) values ('invited@gmail.test', 'Abdullah', 'partner', true)`);
  await signUp(INVITED, "Google Name");
  const [m] = await rows(`select full_name, active, user_id from team_members where email = 'invited@gmail.test'`);
  assert.deepEqual([m.full_name, m.active, m.user_id], ["Abdullah", true, INVITED.sub]);
  assert.equal(await status(INVITED), "active");
});

test("my_member_status is null for someone not on the team at all", async () => {
  assert.equal(await status({ sub: "00000000-0000-0000-0000-0000000000ff", email: "nobody@x.test" }), null);
});
