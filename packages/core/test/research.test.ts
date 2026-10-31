import { test } from "node:test";
import assert from "node:assert/strict";
import { reportErrors, researchReportSchema } from "../src/research.js";

const good = {
  company_id: "6f1c2a7e-1b2c-4d5e-8f90-1234567890ab",
  summary: "Owner-run HVAC company in Tempe that runs Meta ads but has no booking or chat.",
  gaps: [
    { gap: "Only a contact form; no online booking", evidence_url: "https://acme.example/contact" },
    { gap: "No chat or text option", evidence_url: "https://acme.example" },
  ],
  recommended_offer: "speed_to_lead",
  hook: "Saw you offer 24/7 AC repair in Tempe but there's no way to book online.",
  discovery_questions: ["How do you handle after-hours calls?"],
  confidence: 0.8,
};

const errors = (v: unknown) => {
  const r = researchReportSchema.safeParse(v);
  return r.success ? [] : reportErrors(r.error);
};

test("a complete report is accepted, with defaults filled", () => {
  const r = researchReportSchema.parse(good);
  assert.equal(r.source, "claude");
  assert.deepEqual(r.observed, []);
  assert.equal(r.gaps.length, 2);
});

test("a gap without an evidence URL is rejected, naming the gap", () => {
  const e = errors({ ...good, gaps: [good.gaps[0], { gap: "Site looks dated" }] });
  assert.deepEqual(e, ["gaps.1.evidence_url: every gap needs an evidence_url"]);
  assert.match(errors({ ...good, gaps: [{ gap: "x", evidence_url: "acme.example" }] })[0], /full URL/);
});

test("confidence must be between 0 and 1", () => {
  assert.equal(errors({ ...good, confidence: 1.5 }).length, 1);
  assert.equal(errors({ ...good, confidence: -0.1 }).length, 1);
  assert.deepEqual(errors({ ...good, confidence: 0 }), []);
});

test("only the seven offer keys are accepted", () => {
  assert.match(errors({ ...good, recommended_offer: "seo_package" })[0], /^recommended_offer:/);
  assert.deepEqual(errors({ ...good, recommended_offer: null }), []);
  assert.deepEqual(errors({ ...good, recommended_offer: "fsm_integration" }), []);
});
