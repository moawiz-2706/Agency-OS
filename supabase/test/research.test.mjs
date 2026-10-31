// Migration 0004: research reports + recommended offers, with the same RLS as the CRM.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, migrationSql, USERS } from "./harness.mjs";

const { OWNER, PARTNER, OUTSIDER } = USERS;
let db, as, rows, lead, partnerId;

before(async () => {
  ({ db, as, rows } = await createDb());
  // Running 0004 (and 0003 before it) again must be safe.
  await db.exec(migrationSql("0003_crm.sql"));
  await db.exec(migrationSql("0004_research.sql"));
  await db.query(`insert into team_members (user_id, email, full_name, role) values ($1, $2, 'Owner', 'owner'), ($3, $4, 'Partner', 'partner')`,
    [OWNER.sub, OWNER.email, PARTNER.sub, PARTNER.email]);
  partnerId = (await rows(`select id from team_members where email = $1`, [PARTNER.email]))[0].id;
  [{ id: lead }] = await rows(`insert into companies (name, country, source, recommended_offers) values ('Acme HVAC', 'US', 'csv',
    '[{"key":"speed_to_lead","title":"Speed-to-lead for paid leads","priority":90,"reasons":["Runs ads"]}]') returning id`);
});

const report = () => `insert into research_reports (company_id, summary, recommended_offer, gaps)
  values ($1, 'Pays for ads, no booking', 'speed_to_lead', '[{"gap":"No booking","evidence_url":"https://acme.example/contact"}]') returning *`;

test("a team member saves a report; created_by and source default sensibly", async () => {
  const [r] = await as(PARTNER, () => rows(report(), [lead]));
  assert.equal(r.created_by, partnerId);
  assert.equal(r.source, "claude");
  assert.deepEqual(r.raw, {});
});

test("an outsider can't read or write reports or see offers", async () => {
  await as(OUTSIDER, async () => {
    assert.equal((await rows(`select * from research_reports`)).length, 0);
    assert.equal((await rows(`select recommended_offers from companies`)).length, 0);
    await assert.rejects(rows(report(), [lead]));
  });
});

test("only the seven offer keys and three sources are allowed", async () => {
  await as(PARTNER, async () => {
    await assert.rejects(rows(`insert into research_reports (company_id, summary, recommended_offer) values ($1, 'x', 'seo_package')`, [lead]), /research_reports_offer_chk/);
    await assert.rejects(rows(`insert into research_reports (company_id, summary, source) values ($1, 'x', 'chatgpt')`, [lead]), /research_reports_source_chk/);
    const [r] = await rows(`insert into research_reports (company_id, summary, source, recommended_offer, raw) values ($1, 'x', 'external_ai', null, '{"second_offer":"review_automation"}') returning source, raw`, [lead]);
    assert.equal(r.source, "external_ai");
    assert.equal(r.raw.second_offer, "review_automation");
  });
});

test("offers can be filtered with jsonb containment (used by the leads filter)", async () => {
  await as(PARTNER, async () => {
    const hit = await rows(`select id from companies where recommended_offers @> '[{"key":"speed_to_lead"}]'`);
    const miss = await rows(`select id from companies where recommended_offers @> '[{"key":"website_gbp"}]'`);
    assert.deepEqual(hit.map((r) => r.id), [lead]);
    assert.equal(miss.length, 0);
  });
});

test("partners can't delete reports; owners can", async () => {
  const before = (await rows(`select count(*)::int as n from research_reports`))[0].n;
  await as(PARTNER, () => db.query(`delete from research_reports`));
  assert.equal((await rows(`select count(*)::int as n from research_reports`))[0].n, before);
  await as(OWNER, () => db.query(`delete from research_reports`));
  assert.equal((await rows(`select count(*)::int as n from research_reports`))[0].n, 0);
});
