// Migration 0012: tasks, deals, sorting replies, booking link.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, USERS } from "./harness.mjs";

const { OWNER, PARTNER } = USERS;
let db, as, rows, lead, contact, ownerId, partnerId;
const one = async (sql, params) => (await rows(sql, params))[0];
const reply = async (body = "Sounds good") => (await one(
  `insert into inbound_messages (gmail_message_id, company_id, contact_id, from_email, body_text, received_at, handled)
   values (gen_random_uuid()::text, $1, $2, 'darin@swift.test', $3, now(), false) returning id`, [lead, contact, body])).id;
const classify = (id, cls, user = OWNER) => as(user, () => one(`select classify_reply($1, $2) as r`, [id, cls])).then((x) => x.r);
const stage = async () => (await one(`select stage from companies where id = $1`, [lead])).stage;

before(async () => {
  ({ db, as, rows } = await createDb());
  [ownerId, partnerId] = (await rows(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner'), ($3, $4, 'Partner', 'partner') returning id`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email])).map((r) => r.id);
  lead = (await one(`insert into companies (name, country, source, stage, owner_id) values ('Swift Restoration', 'US', 'csv', 'contacted', $1) returning id`, [partnerId])).id;
  contact = (await one(`insert into contacts (company_id, email, full_name, consent_basis) values ($1, 'darin@swift.test', 'Darin', 'can_spam_b2b') returning id`, [lead])).id;
});

test("tasks: team members add and finish them; only the creator or an owner deletes", async () => {
  const id = (await as(PARTNER, () => one(`insert into tasks (company_id, title, due_at) values ($1, 'Call Darin', now()) returning id, assignee_id, created_by`, [lead])));
  assert.equal(id.assignee_id, partnerId);
  await as(OWNER, () => db.query(`update tasks set done_at = now(), done_by = current_member_id() where id = $1`, [id.id]));
  const other = (await as(OWNER, () => one(`insert into tasks (title) values ('Send invoice template') returning id`))).id;
  await as(PARTNER, () => db.query(`delete from tasks where id = $1`, [other]));
  assert.equal((await one(`select count(*)::int n from tasks where id = $1`, [other])).n, 1, "partner can't delete the owner's task");
  await as(OWNER, () => db.query(`delete from tasks where id = $1`, [id.id]));
  assert.equal((await one(`select count(*)::int n from tasks where id = $1`, [id.id])).n, 0, "an owner can");
});

test("one deal per lead, readable and writable by the team", async () => {
  await as(PARTNER, () => db.query(`insert into deals (company_id, offer, setup_fee_cents, monthly_fee_cents) values ($1, 'missed_call_textback', 99700, 29700)`, [lead]));
  await as(PARTNER, () => assert.rejects(db.query(`insert into deals (company_id) values ($1)`, [lead]), /duplicate key/));
  assert.equal((await as(OWNER, () => one(`select monthly_fee_cents from deals where company_id = $1`, [lead]))).monthly_fee_cents, 29700);
});

test("labelling a reply moves the lead and creates the right task", async () => {
  assert.match(await classify(await reply("Yes, let's talk"), "interested"), /Interested/);
  assert.equal(await stage(), "interested");
  const t = await one(`select title, assignee_id, source from tasks where source = 'reply'`);
  assert.deepEqual(t, { title: "Send Darin the booking link", assignee_id: partnerId, source: "reply" });
  // A question later doesn't move it backwards.
  await classify(await reply("What does it cost?"), "pricing");
  assert.equal(await stage(), "interested");
});

test("not now -> nurture, follow-ups stopped, reminder in 60 days; not interested -> lost", async () => {
  await as(OWNER, () => db.query(`select queue_email($1, $2, 'Hi', 'Body', now() + interval '1 day', false, null)`, [lead, contact]));
  await classify(await reply("Busy season, maybe later"), "not_now");
  assert.equal(await stage(), "nurture");
  assert.equal((await one(`select status from outreach_messages`)).status, "cancelled");
  assert.equal((await one(`select (due_at > now() + interval '59 days') as later from tasks where title like 'Check back%'`)).later, true);
  await classify(await reply("No thanks"), "not_interested");
  assert.deepEqual(await one(`select stage, lost_reason from companies where id = $1`, [lead]), { stage: "lost", lost_reason: "Not interested (reply)" });
  assert.equal((await one(`select count(*)::int n from inbound_messages where handled`)).n, 2);
});

test("unsubscribe label suppresses; only owners set the booking link", async () => {
  await classify(await reply("remove me"), "unsubscribe");
  assert.equal((await one(`select do_not_contact from contacts where id = $1`, [contact])).do_not_contact, true);
  assert.equal((await one(`select count(*)::int n from suppressions where email = 'darin@swift.test'`)).n, 1);
  await assert.rejects(classify(await reply("x"), "spam"), /unknown label/);

  await as(PARTNER, () => assert.rejects(db.query(`select set_booking_url('https://thesentinelsystems.com/#book')`), /only an owner/));
  await as(OWNER, () => assert.rejects(db.query(`select set_booking_url('http://insecure.test')`), /https/));
  await as(OWNER, () => db.query(`select set_booking_url('https://thesentinelsystems.com/#book')`));
  assert.equal((await as(PARTNER, () => one(`select booking_url() as u`))).u, "https://thesentinelsystems.com/#book");
});
