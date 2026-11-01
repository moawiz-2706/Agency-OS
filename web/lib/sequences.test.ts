// Run: npm test (from web/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewMerge, stepProblems, unknownFields } from "./sequences.ts";

test("merge-field typos are caught before a sequence is saved", () => {
  assert.deepEqual(unknownFields("Hi {{first_name}}, {{firstname}} at {{ company }}"), ["{{firstname}}", "{{ company }}"]);
  assert.deepEqual(stepProblems([{ day: 1, subject: "Hi {{company}}", body: "Hello {{first_name}}" }, { day: 4, subject: "", body: "Bump" }]), []);
  assert.deepEqual(stepProblems([{ day: 3, subject: "", body: "x {{nme}}" }, { day: 2, subject: "", body: "" }]), [
    "Step 1 needs a subject", "Step 1: {{nme}} isn't a merge field", "Step 2: its day must come after step 1's", "Step 2 needs a message",
  ]);
});

test("preview fills fields like the database does, without leaving a gap", () => {
  assert.equal(previewMerge("Hi {{first_name}},\n\n{{personal_line}}\n\nIn {{city}}?", { company: "Swift" }), "Hi there,\n\nIn your area?");
  assert.equal(previewMerge("{{company}} · {{trade}}", { company: "Swift", trade: "roofing" }), "Swift · roofing");
});
