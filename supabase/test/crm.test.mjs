// Runs migrations 0001-0003 in PGlite (real Postgres in WASM) with stand-ins for
// Supabase's auth schema and roles, then checks RLS and the touch trigger.
// Run: pnpm test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = new URL("../migrations/", import.meta.url);
const db = new PGlite();

const OWNER = { sub: "00000000-0000-0000-0000-00000000000a", email: "owner@agency.test" };
const PARTNER = { sub: "00000000-0000-0000-0000-00000000000b", email: "partner@agency.test" };
const UNLINKED = { sub: "00000000-0000-0000-0000-00000000000c", email: "New.Partner@agency.test" };
const OUTSIDER = { sub: "00000000-0000-0000-0000-0000000000ff", email: "someone@else.test" };

/** Run queries as a logged-in Supabase user (role authenticated + JWT claims), then switch back. */
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: user.sub, email: user.email, role: "authenticated" })]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
const rows = async (sql, params) => (await db.query(sql, params)).rows;

let leadA, leadB, partnerId;

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on all functions in schema auth to anon, authenticated;
  `);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  // Running 0003 twice must be safe.
  await db.exec(readFileSync(new URL("0003_crm.sql", dir), "utf8"));

  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner'), ($3, $4, 'Partner', 'partner'), (null, 'new.partner@agency.test', 'Unlinked', 'partner')`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email]);
  partnerId = (await rows(`select id from team_members where email = $1`, [PARTNER.email]))[0].id;
  [leadA, leadB] = (await rows(`insert into companies (name, country, source) values ('Acme HVAC', 'US', 'csv'), ('Maple Roofing', 'CA', 'csv') returning id`)).map((r) => r.id);
});

test("an outsider sees no rows and can't write", async () => {
  await as(OUTSIDER, async () => {
    for (const t of ["companies", "touches", "notes", "team_members", "contacts", "activities", "v_stage_counts", "v_member_time", "v_lead_facets", "pipeline_summary"]) {
      assert.equal((await rows(`select * from ${t}`)).length, 0, `${t} should be empty for an outsider`);
    }
    await assert.rejects(db.query(`insert into touches (company_id, channel, outcome) values ($1, 'call', 'no_answer')`, [leadA]));
    await assert.rejects(db.query(`insert into notes (company_id, body) values ($1, 'hi')`, [leadA]));
    const upd = await db.query(`update companies set stage = 'won' where id = $1`, [leadA]);
    assert.equal(upd.affectedRows ?? 0, 0);
  });
  assert.equal((await rows(`select stage from companies where id = $1`, [leadA]))[0].stage, "new");
});

test("a team member sees everything; an unlinked member is matched by JWT email", async () => {
  await as(PARTNER, async () => {
    assert.equal((await rows(`select id from companies`)).length, 2);
    assert.equal((await rows(`select id from team_members`)).length, 3);
  });
  await as(UNLINKED, async () => {
    assert.equal((await rows(`select id from companies`)).length, 2);
    assert.equal((await rows(`select is_team_owner() as o`))[0].o, false);
  });
});

test("logging a touch fills member, adds minutes and touches, sets last touch, moves stage forward", async () => {
  await as(PARTNER, async () => {
    await db.query(`insert into touches (company_id, channel, outcome, minutes, happened_at) values ($1, 'call', 'no_answer', 7, '2026-10-30T10:00:00Z')`, [leadA]);
    await db.query(`insert into touches (company_id, channel, outcome, minutes, happened_at) values ($1, 'email', 'sent', 5, '2026-10-29T10:00:00Z')`, [leadA]);
  });
  const [c] = await rows(`select stage, touches_count, minutes_spent, last_touch_at from companies where id = $1`, [leadA]);
  assert.equal(c.stage, "contacted");
  assert.equal(c.touches_count, 2);
  assert.equal(c.minutes_spent, 12);
  assert.equal(new Date(c.last_touch_at).toISOString(), "2026-10-30T10:00:00.000Z"); // the later one, not the last inserted
  const members = await rows(`select distinct member_id from touches where company_id = $1`, [leadA]);
  assert.deepEqual(members.map((m) => m.member_id), [partnerId]);
});

test("stages never move backwards; won/lost are set directly; closed leads stay closed", async () => {
  const touch = (outcome, channel = "call") => as(PARTNER, () =>
    db.query(`insert into touches (company_id, channel, outcome, minutes) values ($1, $2, $3, 1)`, [leadA, channel, outcome]));
  const stage = async () => (await rows(`select stage from companies where id = $1`, [leadA]))[0].stage;

  await touch("interested");                 assert.equal(await stage(), "interested");
  await touch("no_answer");                  assert.equal(await stage(), "interested");
  await touch("replied", "email");           assert.equal(await stage(), "interested");
  await touch("done", "research");           assert.equal(await stage(), "interested");
  await touch("meeting_booked", "meeting");  assert.equal(await stage(), "meeting_booked");
  await touch("sent", "proposal");           assert.equal(await stage(), "proposal_sent");
  await touch("won");                        assert.equal(await stage(), "won");
  await touch("sent", "email");              assert.equal(await stage(), "won");
  await touch("interested");                 assert.equal(await stage(), "won");
});

test("research on a new lead moves it to researching, only from new", async () => {
  await as(PARTNER, () => db.query(`insert into touches (company_id, channel, outcome, minutes) values ($1, 'research', 'done', 20)`, [leadB]));
  assert.equal((await rows(`select stage from companies where id = $1`, [leadB]))[0].stage, "researching");
});

test("stage and owner changes are logged with who made them", async () => {
  await as(PARTNER, () => db.query(`update companies set stage = 'nurture', owner_id = $2 where id = $1`, [leadB, partnerId]));
  const acts = await rows(`select type, payload, member_id, actor from activities where company_id = $1
    and (type = 'owner_changed' or payload ->> 'to' = 'nurture') order by type`, [leadB]);
  assert.deepEqual(acts.map((a) => a.type), ["owner_changed", "stage_changed"]);
  assert.ok(acts.every((a) => a.member_id === partnerId && a.actor === "user"));
  assert.deepEqual(acts[1].payload, { from: "researching", to: "nurture" });
  // A touch can still lift a nurture lead back into the pipeline.
  await as(PARTNER, () => db.query(`insert into touches (company_id, channel, outcome) values ($1, 'email', 'replied')`, [leadB]));
  assert.equal((await rows(`select stage from companies where id = $1`, [leadB]))[0].stage, "replied");
});

test("only an owner can delete; partners can't change the team", async () => {
  await as(PARTNER, async () => {
    const del = await db.query(`delete from notes`);
    assert.equal(del.affectedRows ?? 0, 0);
    await db.query(`delete from companies where id = $1`, [leadB]);
    await assert.rejects(db.query(`insert into team_members (email, role) values ('x@y.test', 'owner')`));
  });
  assert.equal((await rows(`select id from companies where id = $1`, [leadB])).length, 1, "partner delete must not remove the lead");
  await as(OWNER, () => db.query(`delete from companies where id = $1`, [leadB]));
  assert.equal((await rows(`select id from companies where id = $1`, [leadB])).length, 0);
});

test("views roll up minutes per stage and per member", async () => {
  await as(OWNER, async () => {
    const stages = await rows(`select stage, leads, minutes from v_stage_counts`);
    assert.deepEqual(stages, [{ stage: "won", leads: 1, minutes: 21 }]); // 7 + 5 + nine 1-minute touches
    const time = await rows(`select member_name, sum(minutes)::int as m, sum(touches)::int as n from v_member_time group by member_name`);
    assert.deepEqual(time, [{ member_name: "Partner", m: 21, n: 11 }]); // the deleted lead's touches went with it
  });
});
