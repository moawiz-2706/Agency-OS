// Migration 0016: booking calendars, bookings from the public page, Google Calendar connections.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, USERS, migrationFiles, migrationSql } from "./harness.mjs";

const { OWNER, PARTNER } = USERS;
const SECRET = "c".repeat(40);
let db, as, rows, ownerId, cal;
const one = async (sql, params) => (await rows(sql, params))[0];
const inDays = (d, h = 15) => { const t = new Date(Date.now() + d * 86400_000); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };
const book = (start, email = "darin@swift.test", ip = "ip1", name = "Darin") => one(
  `select mailer_booking_create($1, $2, $3, $4, $5, '+1 555 0100', 'Swift Restoration', 'Lots of missed calls', 'https://site.test/book', $6) as r`,
  [SECRET, cal, start, name, email, ip]).then((x) => x.r);

before(async () => {
  ({ db, as, rows } = await createDb());
  [ownerId] = (await rows(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Moawiz', 'owner'), ($3, $4, 'Abdullah', 'partner') returning id`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email])).map((r) => r.id);
  await db.query(`select mailer_set_secret($1)`, [SECRET]);
  cal = (await as(OWNER, () => one(`insert into calendars (host_member_id, name, slug) values (current_member_id(), 'Discovery call', 'discovery') returning id`))).id;
});

test("the team manages calendars; the public page reads one only through the server", async () => {
  await as(PARTNER, () => db.query(`update calendars set duration_min = 20 where id = $1`, [cal]));
  await as(PARTNER, () => assert.rejects(db.query(`insert into calendars (host_member_id, name, slug) values (current_member_id(), 'x', 'Bad Slug')`), /check/));
  const c = (await one(`select mailer_booking_calendar($1, 'DISCOVERY') as c`, [SECRET])).c;
  assert.equal(c.duration_min, 20);
  assert.equal(c.host_name, "Moawiz");
  assert.deepEqual(c.busy, []);
  await assert.rejects(db.query(`select mailer_booking_calendar($1, 'discovery')`, ["x".repeat(40)]), /not authorised/);
  assert.equal((await one(`select mailer_booking_calendar($1, 'nope') as c`, [SECRET])).c, null);
});

test("a booking makes a lead with an express-consent contact, a task, a note and an Inbox item", async () => {
  const r = await book(inDays(3));
  assert.equal(r.new_lead, true);
  const co = await one(`select name, stage, source, owner_id from companies where id = $1`, [r.company_id]);
  assert.deepEqual(co, { name: "Swift Restoration", stage: "meeting_booked", source: "booking", owner_id: ownerId });
  assert.equal((await one(`select consent_basis, phone from contacts where company_id = $1`, [r.company_id])).consent_basis, "express");
  assert.match((await one(`select title from tasks where company_id = $1`, [r.company_id])).title, /^Meeting with Darin/);
  assert.equal((await one(`select classification from inbound_messages where company_id = $1`, [r.company_id])).classification, "meeting_request");
  const b = await as(PARTNER, () => one(`select status, end_at - start_at as len from bookings where id = $1`, [r.id]));
  assert.equal(b.status, "booked");
  // The same person again joins the same lead.
  const again = await book(inDays(5), "Darin@Swift.test", "ip1b");
  assert.equal(again.company_id, r.company_id);
  assert.equal(again.new_lead, false);
});

test("double bookings (with buffers) are refused; so are past times and floods", async () => {
  const start = inDays(4);
  await book(start, "a@x.test", "ip2", "A");
  await assert.rejects(book(start, "b@x.test", "ip3", "B"), /just taken/);
  const inBuffer = new Date(Date.parse(start) + 25 * 60_000).toISOString();   // 20-minute meeting + 15-minute buffer
  await assert.rejects(book(inBuffer, "b@x.test", "ip3", "B"), /just taken/);
  await assert.rejects(book(inDays(-1), "b@x.test", "ip3", "B"), /passed/);
  for (let i = 0; i < 5; i++) await book(inDays(10 + i), `f${i}@x.test`, "flood", "F").catch(() => {});
  await assert.rejects(book(inDays(20), "g@x.test", "flood", "G"), /too many/);
  const busy = (await one(`select mailer_booking_calendar($1, 'discovery') as c`, [SECRET])).c.busy;
  assert.ok(busy.length >= 3);
});

test("cancelling by link or by staff frees the time and closes the task", async () => {
  const r = await book(inDays(6), "c@x.test", "ip4", "Cara");
  const info = (await one(`select mailer_booking_by_token($1, $2) as b`, [SECRET, r.token])).b;
  assert.equal(info.calendar, "Discovery call");
  const res = (await one(`select mailer_booking_cancel($1, $2, 'Found someone else') as r`, [SECRET, r.token])).r;
  assert.equal(res.host_member_id, ownerId);
  assert.equal((await one(`select status from bookings where id = $1`, [r.id])).status, "cancelled");
  assert.ok((await one(`select done_at from tasks where company_id = $1 and title like 'Meeting with Cara%'`, [r.company_id])).done_at);
  await assert.rejects(db.query(`select mailer_booking_cancel($1, $2, null)`, [SECRET, r.token]), /can't be cancelled/);
  await book(inDays(6), "d@x.test", "ip5", "Dee");   // the slot is free again
  const other = await book(inDays(7), "e@x.test", "ip6", "Eve");
  await as(PARTNER, () => db.query(`select cancel_booking($1, 'Rescheduling')`, [other.id]));
  assert.equal((await one(`select status from bookings where id = $1`, [other.id])).status, "cancelled");
});

test("Google Calendar tokens: saved by the member, never readable, handed to the server only with the secret", async () => {
  await as(PARTNER, () => assert.rejects(db.query(`select save_my_calendar_account('a@gmail.test', 'plain')`), /bad calendar token/));
  await as(PARTNER, () => db.query(`select save_my_calendar_account('Abdullah@Gmail.test', 'v1.a.b.c')`));
  await as(PARTNER, () => assert.rejects(db.query(`select * from calendar_accounts`), /permission denied/));
  assert.equal((await as(PARTNER, () => one(`select * from my_calendar_account()`))).email, "abdullah@gmail.test");
  assert.equal((await as(OWNER, () => rows(`select * from my_calendar_account()`))).length, 0);
  const partnerId = (await one(`select id from team_members where role = 'partner'`)).id;
  assert.equal((await one(`select mailer_calendar_account($1, $2) as a`, [SECRET, partnerId])).a.token, "v1.a.b.c");
  await db.query(`select mailer_calendar_error($1, $2, 'revoked', true)`, [SECRET, partnerId]);
  assert.equal((await one(`select mailer_calendar_account($1, $2) as a`, [SECRET, partnerId])).a, null, "needs reconnecting: not used");
  await as(PARTNER, () => db.query(`select disconnect_my_calendar()`));
  assert.equal((await as(OWNER, () => rows(`select * from team_calendar_accounts()`))).length, 0);
});

test("the migration can run again", async () => {
  await db.exec(migrationSql(migrationFiles().find((f) => f.startsWith("0016"))));
  assert.ok((await one(`select count(*)::int n from bookings`)).n > 0);
});
