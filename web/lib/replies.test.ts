// Run: npm test (from web/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestLabel, suggestedReply } from "./replies.ts";

test("replies get a sensible suggested label", () => {
  const cases: [string, string | null][] = [
    ["Please remove me from your list", "unsubscribe"],
    ["No thanks, we already use ServiceTitan", "not_interested"],
    ["Busy season right now, reach out in the spring", "not_now"],
    ["Sure, can you give me a call Tuesday?", "meeting_request"],
    ["How much does this cost per month?", "pricing"],
    ["Sounds interesting, tell me more", "interested"],
    ["Does it work with Jobber?", "question"],
    ["Thanks", null],
  ];
  for (const [text, want] of cases) assert.equal(suggestLabel(text), want, text);
});

test("suggested answers use the booking link when there is one", () => {
  const r = suggestedReply("meeting_request", { first_name: "Darin", my_name: "Moawiz", booking_url: "https://thesentinelsystems.com/#book" });
  assert.equal(r, "Hi Darin,\n\nHappy to. Here's my calendar, pick any time that suits you: https://thesentinelsystems.com/#book\n\nMoawiz");
  assert.match(suggestedReply("interested", {}), /^Hi there,[\s\S]*What day and time suit you this week\?$/);
});
