// Migration 0010: sequences: steps with merge fields, adding leads, bulk approval.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, USERS } from "./harness.mjs";

const { OWNER, PARTNER } = USERS;
let db, as, rows, seq, swift, acme, closed, dnc;
const one = async (sql, params) => (await rows(sql, params))[0];
const enroll = (companies, start = null) =>
  as(OWNER, () => one(`select enroll_in_sequence($1, $2, $3, null) as r`, [seq, companies, start])).then((x) => x.r);

before(async () => {
  ({ db, as, rows } = await createDb());
  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Moawiz Ali', 'owner'), ($3, $4, 'Abdullah', 'partner')`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email]);
  const co = async (name, extra = {}) => (await one(
    `insert into companies (name, country, source, city, trade, time_zone, stage) values ($1, 'US', 'csv', $2, $3, $4, $5) returning id`,
    [name, extra.city ?? null, extra.trade ?? null, extra.tz ?? "America/Chicago", extra.stage ?? "ready"])).id;
  swift = await co("Swift Restoration", { city: "Austin", trade: "restoration" });
  acme = await co("Acme Plumbing");
  closed = await co("Won Co", { stage: "won" });
  dnc = await co("Quiet HVAC");
  await db.query(`insert into contacts (company_id, email, full_name, consent_basis, email_is_role) values
    ($1, 'office@swift.test', null, 'can_spam_b2b', true), ($1, 'darin@swift.test', 'Darin Jenks', 'can_spam_b2b', false),
    ($2, 'info@acme.test', null, 'can_spam_b2b', true), ($3, 'x@won.test', 'X', 'can_spam_b2b', false),
    ($4, 'q@quiet.test', 'Q', 'can_spam_b2b', false)`, [swift, acme, closed, dnc]);
  await db.query(`update contacts set do_not_contact = true where email = 'q@quiet.test'`);
  await db.query(`insert into research_reports (company_id, summary, hook) values ($1, 's', 'Saw your 4.9 stars on Google.')`, [swift]);

  await as(PARTNER, async () => {
    const t1 = (await one(`insert into templates (name, subject, body) values ('1', 'Missed calls at {{company}}?',
      'Hi {{first_name}},\n\n{{personal_line}}\n\nMost {{trade}} teams in {{city}} lose calls after hours.\n\n{{my_name}}') returning id`)).id;
    const t2 = (await one(`insert into templates (name, subject, body) values ('2', '', 'Following up, {{first_name}}.') returning id`)).id;
    seq = (await one(`insert into campaigns (name, template_ids, step_days, send_time) values ('GHL users', $1, '{1,4}', '08:00') returning id`, [[t1, t2]])).id;
  });
});

test("adding leads drafts every step, merged per lead, in the lead's time zone, off weekends", async () => {
  // 2026-11-06 is a Friday: step 2 (day 4 = Monday 9th) stays, step 1 goes Friday 08:00 Chicago.
  const r = await enroll([swift, acme, closed, dnc], "2026-11-06");
  assert.equal(r.enrolled, 2);
  assert.deepEqual(r.skipped.map((s) => s.company).sort(), ["Quiet HVAC", "Won Co"]);
  const msgs = await rows(`select c.email, o.step, o.subject, o.body, o.status, o.member_id is not null as mine,
    to_char(o.scheduled_for at time zone 'America/Chicago', 'Dy YYYY-MM-DD HH24:MI') as at
    from outreach_messages o join contacts c on c.id = o.contact_id order by c.email, o.step`);
  assert.deepEqual(msgs.map((m) => [m.email, m.step, m.status, m.at]), [
    ["darin@swift.test", 1, "pending_approval", "Fri 2026-11-06 08:00"],
    ["darin@swift.test", 2, "pending_approval", "Mon 2026-11-09 08:00"],
    ["info@acme.test", 1, "pending_approval", "Fri 2026-11-06 08:00"],
    ["info@acme.test", 2, "pending_approval", "Mon 2026-11-09 08:00"],
  ]);
  const [darin1, darin2, acme1] = msgs;
  assert.equal(darin1.subject, "Missed calls at Swift Restoration?");
  assert.equal(darin1.body, "Hi Darin,\n\nSaw your 4.9 stars on Google.\n\nMost restoration teams in Austin lose calls after hours.\n\nMoawiz");
  assert.equal(darin2.subject, "Re: Missed calls at Swift Restoration?");
  // No name, no research, no city: sensible fallbacks and no blank gap.
  assert.equal(acme1.body, "Hi there,\n\nMost home service teams in your area lose calls after hours.\n\nMoawiz");
  // A Saturday start moves to Monday.
  await as(OWNER, () => db.query(`select remove_from_sequence($1, $2)`, [seq, acme]));
  await db.query(`delete from campaign_members where company_id = $1`, [acme]);
  await enroll([acme], "2026-11-07");
  assert.equal((await one(`select to_char(scheduled_for at time zone 'America/Chicago', 'Dy HH24:MI') as at from outreach_messages
    where company_id = $1 and status = 'pending_approval' and step = 1`, [acme])).at, "Mon 08:00");
});

test("the same lead isn't added twice, and paused sequences take no one", async () => {
  const r = await enroll([swift]);
  assert.equal(r.enrolled, 0);
  assert.match(r.skipped[0].reason, /already in this sequence/);
  await as(OWNER, () => db.query(`select set_sequence_status($1, 'paused')`, [seq]));
  await assert.rejects(enroll([acme]), /paused/);
  await as(OWNER, () => db.query(`select set_sequence_status($1, 'active')`, [seq]));
});

test("approve all approves only my own drafts; pausing sends approved ones back for approval", async () => {
  const r = await as(OWNER, () => one(`select approve_sequence_drafts($1) as r`, [seq]));
  assert.equal(r.r.approved, 4);
  assert.equal((await as(PARTNER, () => one(`select approve_sequence_drafts($1) as r`, [seq]))).r.approved, 0);
  await as(OWNER, () => db.query(`select set_sequence_status($1, 'paused')`, [seq]));
  assert.equal((await one(`select count(*)::int n from outreach_messages where status = 'approved'`)).n, 0);
  const s = await as(OWNER, () => one(`select * from sequence_summary() where campaign_id = $1`, [seq]));
  assert.deepEqual([s.leads, s.needs_approval, s.scheduled, s.sent], [2, 4, 0, 0]);
});

test("removing a lead cancels what hasn't gone out", async () => {
  const n = (await as(OWNER, () => one(`select remove_from_sequence($1, $2) as n`, [seq, swift]))).n;
  assert.equal(n, 2);
  assert.equal((await one(`select count(*)::int n from outreach_messages where company_id = $1 and status <> 'cancelled'`, [swift])).n, 0);
});
