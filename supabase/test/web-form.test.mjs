// Migration 0011: website enquiries become leads.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const SECRET = "w".repeat(40);
let db, rows;
const one = async (sql, params) => (await rows(sql, params))[0];
async function submit(f, ip = "ip1", secret = SECRET) {
  await db.exec("set role anon");
  try {
    return (await db.query(`select web_form_submit($1, $2, $3, $4, $5, $6, $7, $8, $9) as r`,
      [secret, f.name ?? "Darin Jenks", f.email, f.company ?? null, f.website ?? null, f.tools ?? null, f.pain ?? null, "https://thesentinelsystems.com/", ip])).rows[0].r;
  } finally { await db.exec("reset role"); }
}

before(async () => {
  ({ db, rows } = await createDb());
  await db.query(`select mailer_set_secret($1)`, [SECRET]);
});

test("a new enquiry creates an interested lead with an express-consent contact, a note and an inbox item", async () => {
  await assert.rejects(submit({ email: "a@b.test" }, "ip1", "x".repeat(40)), /not authorised/);
  const r = await submit({ email: "Darin@Swift.test", company: "Swift Restoration", website: "https://www.swift.test/about", tools: "Jobber", pain: "Chasing quotes" });
  assert.equal(r.new_lead, true);
  const co = await one(`select name, stage, source, website_domain from companies where id = $1`, [r.company_id]);
  assert.deepEqual(co, { name: "Swift Restoration", stage: "interested", source: "web_form", website_domain: "swift.test" });
  const ct = await one(`select full_name, email, consent_basis from contacts where company_id = $1`, [r.company_id]);
  assert.deepEqual(ct, { full_name: "Darin Jenks", email: "darin@swift.test", consent_basis: "express" });
  assert.match((await one(`select body from notes where company_id = $1`, [r.company_id])).body, /Tools they use: Jobber\nBiggest time-waster: Chasing quotes/);
  const inbox = await one(`select subject, classification, handled from inbound_messages where company_id = $1`, [r.company_id]);
  assert.deepEqual(inbox, { subject: "Website enquiry", classification: "question", handled: false });
});

test("a known email or website joins the existing lead and lifts its stage", async () => {
  const lead = (await one(`insert into companies (name, source, website_domain, stage) values ('Acme Plumbing', 'csv', 'acme.test', 'contacted') returning id`)).id;
  await db.query(`insert into contacts (company_id, email, consent_basis) values ($1, 'office@acme.test', 'can_spam_b2b')`, [lead]);
  const byEmail = await submit({ email: "OFFICE@acme.test" }, "ip2");
  assert.deepEqual([byEmail.company_id, byEmail.new_lead], [lead, false]);
  assert.equal((await one(`select consent_basis from contacts where email = 'office@acme.test'`)).consent_basis, "express");
  const bySite = await submit({ name: "Joe", email: "joe@gmail.test", website: "acme.test" }, "ip2");
  assert.equal(bySite.company_id, lead);
  assert.equal((await one(`select stage from companies where id = $1`, [lead])).stage, "interested");
  assert.equal((await one(`select count(*)::int n from contacts where company_id = $1`, [lead])).n, 2);
});

test("bad input and floods are refused", async () => {
  await assert.rejects(submit({ email: "nope" }, "ip3"), /valid email/);
  await assert.rejects(submit({ name: " ", email: "a@b.test" }, "ip3"), /your name/);
  for (let i = 0; i < 5; i++) await submit({ email: `p${i}@flood.test` }, "ip4");
  await assert.rejects(submit({ email: "p6@flood.test" }, "ip4"), /too many enquiries/);
  await submit({ email: "other@ok.test" }, "ip5");   // someone else is fine
});
