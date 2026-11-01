// Run: npm test (from web/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "./csv.ts";
import { OUTPUT_COLUMNS, buildPrompt, checkImport, schedule, type ImportLead } from "./ai-emails.ts";

test("CSV round-trips commas, quotes and line breaks", () => {
  const text = toCsv(["a", "b"], [{ a: 'Hi "Darin",\nline 2', b: 1 }, { a: "", b: 0 }]);
  assert.ok(text.startsWith("﻿a,b\r\n"));
  const { header, rows } = parseCsv(text);
  assert.deepEqual(header, ["a", "b"]);
  assert.deepEqual(rows, [{ a: 'Hi "Darin",\nline 2', b: "1" }, { a: "", b: "0" }]);
  assert.deepEqual(parseCsv("Lead_ID , Step\r\nx,1\r\n\r\n").rows, [{ lead_id: "x", step: "1" }]);
});

test("the prompt names the exact output columns and the sending days", () => {
  const p = buildPrompt({ emails: 3, days: [1, 4, 8, 14], senderName: "Moawiz", agency: "The Sentinel Systems", offers: { missed_call_textback: "Missed-call text-back" } });
  assert.match(p, /lead_id,contact_email,step,send_day,subject,body/);
  assert.match(p, /sequence of \*\*3 emails\*\*, sent on days \*\*1, 4, 8\*\*/);
  assert.match(p, /No signature/);
});

const leads: ImportLead[] = [
  { company_id: "11111111-aaaa-4aaa-8aaa-111111111111", name: "Swift Restoration", lead_ref: "MANUS-001", time_zone: "America/Chicago",
    contacts: [{ id: "c1", email: "darin@swift.test" }, { id: "c2", email: "office@swift.test" }], blocked: null },
  { company_id: "22222222-bbbb-4bbb-8bbb-222222222222", name: "Acme Plumbing", lead_ref: null, time_zone: "America/New_York",
    contacts: [{ id: "c3", email: "info@acme.test" }], blocked: null },
  { company_id: "33333333-cccc-4ccc-8ccc-333333333333", name: "Busy HVAC", lead_ref: null, time_zone: "America/Denver",
    contacts: [{ id: "c4", email: "a@busy.test" }], blocked: "it already has emails waiting" },
];
const row = (lead_id: string, step: number, subject: string, body: string, extra: Record<string, string> = {}) =>
  ({ lead_id, contact_email: "", step: String(step), send_day: "", subject, body, ...extra });

test("the AI's rows become complete sequences; anything wrong skips that whole lead", () => {
  const rows = [
    row("MANUS-001", 2, "", "Following up", { contact_email: "Darin@Swift.test", send_day: "4" }),
    row("MANUS-001", 1, "missed calls at swift?", "Hi Darin,\n\nNoticed…", { contact_email: "darin@swift.test", send_day: "1" }),
    row("22222222-bbbb-4bbb-8bbb-222222222222", 1, "quick one", "Hi [First Name], …"),
    row("33333333-cccc-4ccc-8ccc-333333333333", 1, "hi", "Body"),
    row("nobody", 1, "x", "y"),
  ];
  const r = checkImport([...OUTPUT_COLUMNS], rows, leads);
  assert.equal(r.leads, 1);
  assert.deepEqual(r.emails.map((e) => [e.company, e.contact_id, e.step, e.send_day, e.subject]), [
    ["Swift Restoration", "c1", 1, 1, "missed calls at swift?"],
    ["Swift Restoration", "c1", 2, 4, "Re: missed calls at swift?"],
  ]);
  assert.equal(r.problems.length, 3);
  assert.match(r.problems[0], /"nobody" isn't one of the exported leads/);
  assert.match(r.problems.join("\n"), /Acme Plumbing.*placeholder/);
  assert.match(r.problems.join("\n"), /Busy HVAC.*already has emails waiting/);
  assert.match(checkImport(["lead_id", "subject"], [], leads).problems[0], /missing the column\(s\): step, body/);
});

test("emails are scheduled per lead time zone, off weekends, never in the past", () => {
  const { emails } = checkImport([...OUTPUT_COLUMNS], [
    row("MANUS-001", 1, "hi", "a", { send_day: "1" }), row("MANUS-001", 2, "", "b", { send_day: "2" }),
  ], leads);
  // Friday 6 Nov 2026, 08:00 Chicago; day 2 would be Saturday -> Monday 9 Nov.
  const when = schedule(emails, "2026-11-06", "08:00", true, new Date("2026-11-05T00:00:00Z"));
  assert.deepEqual(emails.map((e) => when.get(e)), ["2026-11-06T14:00:00.000Z", "2026-11-09T14:00:00.000Z"]);
  // Start date already past in Chicago: moves to the next day.
  const late = schedule(emails, "2026-11-06", "08:00", false, new Date("2026-11-06T20:00:00Z"));
  assert.equal(late.get(emails[0]), "2026-11-07T14:00:00.000Z");
});
