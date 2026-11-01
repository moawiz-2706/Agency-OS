// Run: npm test (from web/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bounceAlarm, deliverability, funnel, pct, type FunnelLead } from "./reports.ts";

const lead = (id: string, stage: string, extra: Partial<FunnelLead> = {}): FunnelLead =>
  ({ id, stage, trade: "hvac", region: "TX", source: "csv", touches_count: 0, ...extra });

test("the funnel counts how far each lead got, including lost and nurture leads", () => {
  const leads = [
    lead("a", "new"), lead("b", "contacted"), lead("c", "interested", { trade: "roofing" }), lead("d", "won"),
    lead("e", "lost", { touches_count: 2 }), lead("f", "nurture", { touches_count: 1 }), lead("g", "lost"),
  ];
  const [all] = funnel(leads, new Set(["f"]));
  assert.deepEqual(all.counts, { leads: 7, contacted: 5, replied: 3, interested: 2, meeting: 1, won: 1 });
  const byTrade = funnel(leads, new Set(), (l) => l.trade);
  assert.deepEqual(byTrade.map((r) => [r.key, r.counts.leads, r.counts.contacted]), [["hvac", 6, 4], ["roofing", 1, 1]]);
  assert.equal(pct(1, 4), "25%");
  assert.equal(pct(1, 0), "–");
});

test("deliverability is bucketed by team day, and the bounce alarm matches the guard", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const rows = deliverability({
    sent: ["2026-11-02T05:00:00Z", "2026-11-01T20:00:00Z", "2026-10-01T00:00:00Z"],
    bounced: ["2026-11-01T20:30:00Z"], replies: [], unsubscribed: ["2026-11-02T09:00:00Z"],
  }, 3, "Asia/Karachi", now);
  assert.deepEqual(rows.map((r) => [r.day, r.sent, r.bounced, r.unsubscribed]),
    [["2026-11-02", 2, 1, 1], ["2026-11-01", 0, 0, 0], ["2026-10-31", 0, 0, 0]]);
  assert.equal(bounceAlarm(100, 2), false);
  assert.equal(bounceAlarm(20, 2), true);
  assert.equal(bounceAlarm(5, 1), false);
});
