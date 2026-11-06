// Migration 0015: marketing design, per-email / per-sequence design, fixing waiting emails.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, USERS } from "./harness.mjs";

const { OWNER, PARTNER } = USERS;
const SECRET = "e".repeat(40);
let db, as, rows, lead, contact, partnerEmail, campaign;
const one = async (sql, params) => (await rows(sql, params))[0];

before(async () => {
  ({ db, as, rows } = await createDb());
  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner'), ($3, $4, 'Partner', 'partner')`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email]);
  await db.query(`select mailer_set_secret($1)`, [SECRET]);
  lead = (await one(`insert into companies (name, country, source) values ('Swift Restoration', 'US', 'csv') returning id`)).id;
  contact = (await one(`insert into contacts (company_id, email, full_name, consent_basis) values ($1, 'darin@swift.test', 'Darin', 'can_spam_b2b') returning id`, [lead])).id;
  await as(PARTNER, () => db.query(`select queue_email($1, $2, 'Hi Darin', 'Body', now() + interval '1 day', false, null)`, [lead, contact]));
  partnerEmail = (await one(`select id from outreach_messages`)).id;
  await as(PARTNER, () => db.query(`select approve_email($1)`, [partnerEmail]));
  campaign = (await one(`insert into campaigns (name, design) values ('Nurture', 'marketing') returning id`)).id;
});

test("the marketing design has a default; only owners change it, with checks", async () => {
  assert.equal((await as(PARTNER, () => one(`select email_marketing() as d`))).d.header, "THE SENTINEL SYSTEMS");
  await as(PARTNER, () => assert.rejects(db.query(`select set_email_marketing('{"header":"X"}')`), /only an owner/));
  await as(OWNER, () => assert.rejects(db.query(`select set_email_marketing('{"header":"X","cta_url":"http://x.test"}')`), /https/));
  await as(OWNER, () => db.query(`select set_email_marketing('{"header":"ACME","tagline":"t","cta_text":"Book","cta_url":"https://cal.test","accent":"#000000"}')`));
  const d = (await one(`select mailer_email_designs($1) as d`, [SECRET])).d;
  assert.equal(d.marketing.header, "ACME");
  assert.equal(d.outreach.style, "personal");
});

test("an owner can fix a partner's approved email; it goes back to the partner for approval", async () => {
  assert.equal((await as(OWNER, () => one(`select team_update_email($1, 'Hi Darin', 'New body', 'marketing') as r`, [partnerEmail]))).r, "needs_approval");
  assert.deepEqual(await one(`select status, body, design, approved_at from outreach_messages where id = $1`, [partnerEmail]),
    { status: "pending_approval", body: "New body", design: "marketing", approved_at: null });
  assert.equal((await as(PARTNER, () => one(`select team_update_email($1, 'Hi Darin', 'Mine again', 'outreach') as r`, [partnerEmail]))).r, "saved");
});

test("a partner can't edit or restyle the owner's emails", async () => {
  const owners = [(await one(`insert into outreach_messages (company_id, contact_id, member_id, subject, body, status, idempotency_key)
    values ($1, $2, (select id from team_members where role = 'owner'), 'From owner', 'Body', 'approved', 'owner-test') returning id`, [lead, contact])).id];
  await as(PARTNER, () => assert.rejects(db.query(`select team_update_email($1, 's', 'b', null)`, [owners[0]]), /author or an owner/));
  assert.equal((await as(PARTNER, () => one(`select set_emails_design($1, 'marketing') as n`, [owners]))).n, 0);
});

test("the worker's design per email: the email's own, else its sequence's, else outreach", async () => {
  const design = async (id) => (await one(`select mailer_message_design($1, $2) as d`, [SECRET, id])).d;
  await db.query(`update outreach_messages set design = null, campaign_id = $2 where id = $1`, [partnerEmail, campaign]);
  assert.equal(await design(partnerEmail), "marketing");
  await db.query(`update outreach_messages set design = 'outreach' where id = $1`, [partnerEmail]);
  assert.equal(await design(partnerEmail), "outreach");
  await db.query(`update outreach_messages set design = null, campaign_id = null where id = $1`, [partnerEmail]);
  assert.equal(await design(partnerEmail), "outreach");
  await assert.rejects(db.query(`select mailer_message_design($1, $2)`, ["x".repeat(40), partnerEmail]), /not authorised/);
});
