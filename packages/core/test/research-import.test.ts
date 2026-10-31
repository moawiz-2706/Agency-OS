import { test } from "node:test";
import assert from "node:assert/strict";
import { RESULT_COLUMNS, missingResultColumns, planResearchRow, type ResultRow, type RowContext, type RowPlan } from "../src/research-import.js";

const COMPANY = { id: "6f1c2a7e-1b2c-4d5e-8f90-1234567890ab", stage: "new", country: "US" as const };
const OWNER = "0b5d3c8e-0000-4000-8000-000000000001";

function row(over: Partial<ResultRow> = {}): ResultRow {
  const base = Object.fromEntries(RESULT_COLUMNS.map((c) => [c, ""])) as ResultRow;
  return {
    ...base,
    lead_id: "OSM-0042", business_name: "Acme HVAC", status: "active", website_checked: "https://acme.example",
    owner_name: "Jane Doe", owner_name_source_url: "https://acme.example/about",
    best_email: "Office@Acme.example", email_source_url: "https://acme.example/contact", email_on_own_site: "yes",
    no_unsolicited_email_notice: "no", google_rating: "4.1", google_review_count: "23", reviews_source_url: "https://maps.google.com/?cid=1",
    gap_1: "Only a contact form; no online booking", gap_1_evidence_url: "https://acme.example/contact",
    gap_2: "No chat or text option", gap_2_evidence_url: "https://acme.example",
    recommended_offer: "speed_to_lead", second_offer: "review_automation",
    offer_reason: "They pay for Meta ads but leads can only call or fill a form.",
    email_hook: "Saw you offer 24/7 AC repair in Tempe but there's no way to book online.",
    discovery_questions: "How do you handle after-hours calls? | Who replies to form leads? | How many jobs come from ads?",
    fit_score: "85", confidence: "0.8", website_quality: "dated", research_notes: "Checked site + GBP",
    ...over,
  };
}
const ctx = (over: Partial<RowContext> = {}): RowContext => ({
  company: COMPANY, contactEmails: new Set(), ownerNames: new Set(), ownerMemberId: OWNER, ...over,
});
function ok(p: RowPlan) {
  assert.equal(p.kind, "ok", p.kind !== "ok" ? `${p.kind}: ${p.reason}` : "");
  return p as Extract<RowPlan, { kind: "ok" }>;
}

test("a good row becomes a report, lead updates, contacts and a touch", () => {
  const p = ok(planResearchRow(row(), ctx(), "results_01.csv"));
  assert.equal(p.action, "insert");
  assert.equal(p.report.source, "external_ai");
  assert.equal(p.report.created_by, OWNER);
  assert.equal(p.report.summary, "They pay for Meta ads but leads can only call or fill a form.");
  assert.equal(p.report.recommended_offer, "speed_to_lead");
  assert.equal(p.report.gaps.length, 2);
  assert.equal(p.report.discovery_questions.length, 3);
  assert.equal(p.report.raw.second_offer, "review_automation");
  assert.equal(p.report.raw.website_quality, "dated");
  assert.deepEqual(p.company.patch, { rating: 4.1, review_count: 23, reviews_source_url: "https://maps.google.com/?cid=1", score: 85, tier: "high", stage: "researching" });
  assert.equal(p.touch, true);
  const [email, owner] = p.contacts;
  assert.equal(email.email, "office@acme.example");
  assert.equal(email.consent_basis, "can_spam_b2b");
  assert.equal(email.do_not_contact, false);
  assert.deepEqual([owner.full_name, owner.role, owner.source_url], ["Jane Doe", "owner", "https://acme.example/about"]);
});

test("the EXAMPLE row and unknown lead_ids are skipped", () => {
  assert.deepEqual(planResearchRow(row({ lead_id: "EXAMPLE-0000" }), ctx(), "f"), { kind: "skip", lead_id: "EXAMPLE-0000", reason: "example row" });
  const p = planResearchRow(row({ lead_id: "OSM-9999" }), ctx({ company: undefined }), "f");
  assert.equal(p.kind, "skip");
});

test("a gap without a URL is dropped; a row with no surviving gap is rejected unless closed/down", () => {
  const p = ok(planResearchRow(row({ gap_2_evidence_url: "" }), ctx(), "f"));
  assert.equal(p.report.gaps.length, 1);
  assert.deepEqual(p.dropped_gaps, ["gap_2 (no evidence URL)"]);
  const none = { gap_1_evidence_url: "see website", gap_2_evidence_url: "" };
  assert.equal(planResearchRow(row(none), ctx(), "f").kind, "reject");
  assert.equal(planResearchRow(row({ ...none, status: "website_down" }), ctx(), "f").kind, "ok");
});

test("an unknown offer key is rejected; `none` means no offer", () => {
  const p = planResearchRow(row({ recommended_offer: "seo_package" }), ctx(), "f");
  assert.equal(p.kind, "reject");
  assert.match((p as { reason: string }).reason, /seo_package/);
  assert.equal(planResearchRow(row({ second_offer: "ads_management" }), ctx(), "f").kind, "reject");
  assert.equal(ok(planResearchRow(row({ recommended_offer: "none", second_offer: "" }), ctx(), "f")).report.recommended_offer, null);
});

test("confidence is clamped to 0-1", () => {
  assert.equal(ok(planResearchRow(row({ confidence: "1.4" }), ctx(), "f")).report.confidence, 1);
  assert.equal(ok(planResearchRow(row({ confidence: "-2" }), ctx(), "f")).report.confidence, 0);
});

test("Canada: CASL basis only when published on their own site with no 'no spam' notice", () => {
  const ca = ctx({ company: { ...COMPANY, country: "CA" } });
  assert.equal(ok(planResearchRow(row(), ca, "f")).contacts[0].consent_basis, "casl_implied_published");
  assert.equal(ok(planResearchRow(row({ no_unsolicited_email_notice: "unknown" }), ca, "f")).contacts[0].consent_basis, "unknown");
  // Not on their own site / no source URL: the email isn't added at all.
  assert.ok(ok(planResearchRow(row({ email_on_own_site: "no" }), ca, "f")).contacts.every((c) => !c.email));
  assert.ok(ok(planResearchRow(row({ email_source_url: "" }), ca, "f")).contacts.every((c) => !c.email));
});

test("a 'no unsolicited email' notice marks the contact do-not-contact", () => {
  const us = ok(planResearchRow(row({ no_unsolicited_email_notice: "yes" }), ctx(), "f")).contacts[0];
  assert.equal(us.do_not_contact, true);
  const ca = ok(planResearchRow(row({ no_unsolicited_email_notice: "yes" }), ctx({ company: { ...COMPANY, country: "CA" } }), "f")).contacts[0];
  assert.deepEqual([ca.do_not_contact, ca.consent_basis], [true, "unknown"]);
});

test("re-importing updates the existing report, adds no duplicate contacts or touches", () => {
  const p = ok(planResearchRow(row(), ctx({
    existingReportId: "11111111-1111-4111-8111-111111111111",
    contactEmails: new Set(["office@acme.example"]),
    ownerNames: new Set(["jane doe"]),
    company: { ...COMPANY, stage: "researching" },
  }), "f"));
  assert.equal(p.action, "update");
  assert.equal(p.report_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(p.contacts.length, 0);
  assert.equal(p.touch, false);
  assert.equal(p.company.patch.stage, undefined, "already past new: stage untouched");
});

test("closed businesses are disqualified with a note; won leads are left alone", () => {
  const closed = row({ status: "closed", gap_1: "", gap_2: "", fit_score: "0" });
  const p = ok(planResearchRow(closed, ctx({ company: { ...COMPANY, stage: "contacted" } }), "f"));
  assert.equal(p.company.patch.stage, "disqualified");
  assert.equal(p.note, "closed per research");
  const won = ok(planResearchRow(closed, ctx({ company: { ...COMPANY, stage: "won" } }), "f"));
  assert.equal(won.company.patch.stage, undefined);
});

test("reviews are only taken when a reviews_source_url is given", () => {
  const p = ok(planResearchRow(row({ reviews_source_url: "" }), ctx(), "f"));
  assert.equal(p.company.patch.rating, undefined);
  assert.equal(p.company.patch.review_count, undefined);
});

test("the header check names missing columns", () => {
  assert.deepEqual(missingResultColumns([...RESULT_COLUMNS]), []);
  assert.deepEqual(missingResultColumns(RESULT_COLUMNS.filter((c) => c !== "fit_score")), ["fit_score"]);
});
