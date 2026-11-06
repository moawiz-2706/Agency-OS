import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HOURS, availableSlots, checkBookingForm, dayIn, isBookable, rulesProblems, slugify, type CalendarRules } from "./booking.ts";

const rules: CalendarRules = {
  timezone: "America/New_York", availability: DEFAULT_HOURS, duration_min: 30, slot_interval_min: 30,
  buffer_before_min: 0, buffer_after_min: 15, min_notice_hours: 12, max_days_ahead: 14, max_per_day: null,
};
// Monday 9 Nov 2026, 06:00 in New York (11:00 UTC).
const NOW = new Date("2026-11-09T11:00:00Z");

test("weekday hours in the calendar's time zone, with minimum notice", () => {
  const slots = availableSlots(rules, [], [], NOW, undefined, 3);
  // 12 hours' notice: nothing on Monday before 18:00 New York (after hours), so Tuesday 09:00 is first.
  assert.equal(slots[0], "2026-11-10T14:00:00.000Z");
  assert.equal(slots.filter((s) => s.startsWith("2026-11-10")).length, 16);       // 09:00–16:30
  assert.ok(!slots.some((s) => s.startsWith("2026-11-09")));
});

test("weekends are closed and the booking window ends", () => {
  const all = availableSlots(rules, [], [], NOW);
  const days = new Set(all.map((s) => dayIn("America/New_York", new Date(s))));
  assert.ok(!days.has("2026-11-14") && !days.has("2026-11-15"), "Sat/Sun closed");
  assert.ok([...days].every((d) => d <= "2026-11-22"), "14-day window");
});

test("busy times block slots, with the buffers on both sides", () => {
  const busy = [{ start: "2026-11-10T15:00:00Z", end: "2026-11-10T15:30:00Z" }];   // 10:00–10:30 NY
  const tue = availableSlots(rules, busy, [], NOW, "2026-11-10", 1);
  assert.ok(!tue.includes("2026-11-10T15:00:00.000Z"));
  assert.ok(!tue.includes("2026-11-10T14:30:00.000Z"), "09:30 would end at 10:00 + 15 min buffer");
  assert.ok(!tue.includes("2026-11-10T15:30:00.000Z"), "10:30 is inside the 15-minute buffer after");
  assert.ok(tue.includes("2026-11-10T16:00:00.000Z"));
  assert.equal(isBookable(rules, busy, [], NOW, "2026-11-10T16:00:00Z"), true);
  assert.equal(isBookable(rules, busy, [], NOW, "2026-11-10T15:30:00Z"), false);
  assert.equal(isBookable(rules, [], [], NOW, "2026-11-10T14:10:00Z"), false, "not on the interval");
});

test("the daily cap counts this calendar's bookings", () => {
  const booked = [{ start: "2026-11-10T14:00:00Z", end: "2026-11-10T14:30:00Z" }];
  assert.equal(availableSlots({ ...rules, max_per_day: 1 }, [], booked, NOW, "2026-11-10", 1).length, 0);
  assert.ok(availableSlots({ ...rules, max_per_day: 2 }, [], booked, NOW, "2026-11-10", 1).length > 0);
});

test("settings are checked in plain words", () => {
  assert.deepEqual(rulesProblems(rules), []);
  const bad = rulesProblems({ ...rules, timezone: "Mars/Base", duration_min: 0, availability: { "1": [{ start: "17:00", end: "09:00" }] } });
  assert.ok(bad.some((p) => /time zone/.test(p)));
  assert.ok(bad.some((p) => /Meeting length/.test(p)));
  assert.ok(bad.some((p) => /Monday/.test(p)));
  assert.ok(rulesProblems({ ...rules, availability: {} }).includes("Open at least one day"));
});

test("slugs and the booking form", () => {
  assert.equal(slugify("Discovery Call (15 min) – Moawiz"), "discovery-call-15-min-moawiz");
  assert.deepEqual(checkBookingForm({ company_url: "x" }), { ok: "spam" });
  assert.equal(checkBookingForm({ name: "", email: "a@b.co", start: "2026-11-10T14:00:00Z" }).ok, false);
  const ok = checkBookingForm({ name: "Mike", email: "Mike@Torres.TEST", start: "2026-11-10T14:00:00Z" });
  assert.ok(ok.ok === true && ok.form.email === "mike@torres.test");
});
