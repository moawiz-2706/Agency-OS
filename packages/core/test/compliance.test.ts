import { test } from "node:test";
import assert from "node:assert/strict";
import { consentForImport, isRoleAddress, sendBlockers, type SendCheck } from "../src/compliance.js";

const ok: SendCheck = {
  email: "mike@acmehvac.com", email_status: "valid", consent_basis: "can_spam_b2b",
  do_not_contact: false, country: "US", suppressed: false,
};

test("a verified US contact with a CAN-SPAM basis can be emailed", () => {
  assert.deepEqual(sendBlockers(ok), []);
});

test("SPEC M3: a Canadian contact with unknown consent can't be emailed", () => {
  const b = sendBlockers({ ...ok, country: "CA", consent_basis: "unknown" });
  assert.ok(b.includes("no consent basis recorded"));
  assert.ok(b.includes("Canadian contact without a CASL basis"));
  // A US-only basis isn't enough in Canada either.
  assert.deepEqual(sendBlockers({ ...ok, country: "CA", consent_basis: "can_spam_b2b" }), ["Canadian contact without a CASL basis"]);
  assert.deepEqual(sendBlockers({ ...ok, country: "CA", consent_basis: "casl_implied_published" }), []);
});

test("SPEC M3: suppressed, do-not-contact, bounced and unverified contacts can't be emailed", () => {
  assert.deepEqual(sendBlockers({ ...ok, suppressed: true }), ["on the suppression list"]);
  assert.deepEqual(sendBlockers({ ...ok, do_not_contact: true }), ["marked do-not-contact"]);
  assert.deepEqual(sendBlockers({ ...ok, email_status: "bounced" }), ["email bounced before"]);
  assert.equal(sendBlockers({ ...ok, email_status: "unknown" }).length, 1);
  assert.equal(sendBlockers({ ...ok, email_status: "invalid" }).length, 1);
  assert.deepEqual(sendBlockers({ ...ok, email_status: "risky" }), []); // role address: allowed, flagged
});

test("import consent: US gets CAN-SPAM, Canada only with proof the email is on their own site", () => {
  assert.equal(consentForImport("US", "a@x.com", null, "x.com").basis, "can_spam_b2b");
  assert.equal(consentForImport("CA", "a@x.ca", null, "x.ca").basis, "unknown");
  assert.equal(consentForImport("CA", "a@x.ca", "https://directory.example/listing/1", "x.ca").basis, "unknown");
  assert.deepEqual(consentForImport("CA", "a@x.ca", "https://www.x.ca/contact", "x.ca"), { basis: "casl_implied_published", published: true });
  assert.equal(consentForImport("CA", null, "https://x.ca/contact", "x.ca").basis, "unknown");
  assert.equal(consentForImport(null, "a@x.com", null, "x.com").basis, "unknown");
});

test("role addresses are flagged", () => {
  assert.equal(isRoleAddress("info@acme.com"), true);
  assert.equal(isRoleAddress("customer.service@acme.com"), true);
  assert.equal(isRoleAddress("mike@acme.com"), false);
});
