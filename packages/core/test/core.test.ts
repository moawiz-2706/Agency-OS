import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreLead, statusForScore } from "../src/scoring.js";
import { detectSignals } from "../src/signals.js";

const base = { business_status: "OPERATIONAL", phone: "(214) 555-0100", website: "https://acmehvac.com", rating: 4.1, review_count: 23 };

test("weak online presence + ad spend scores high", () => {
  const html = `<html><head><title>Acme HVAC</title><meta name="viewport" content="x">
    <script src="https://connect.facebook.net/en_US/fbevents.js"></script></head>
    <body><form></form> Email info@acmehvac.com</body></html>`;
  const s = detectSignals(html, "https://acmehvac.com/");
  assert.equal(s.has_ad_pixel, true);
  assert.equal(s.has_online_booking, false);
  assert.deepEqual(s.emails_found, ["info@acmehvac.com"]);
  const r = scoreLead({ ...base, signals: s });
  assert.equal(r.tier, "high");
  assert.equal(statusForScore(r), "qualified");
});

test("already on GHL with booking + chat scores low", () => {
  const html = `<meta name="viewport"><script src="https://widgets.leadconnectorhq.com/loader.js"></script>
    <a href="https://calendly.com/x">Book online</a>`;
  const s = detectSignals(html, "https://x.com");
  assert.equal(s.uses_ghl, true);
  const r = scoreLead({ ...base, rating: 4.9, review_count: 400, signals: s });
  assert.equal(r.tier, "low");
});

test("closed business is disqualified", () => {
  const r = scoreLead({ ...base, business_status: "CLOSED_PERMANENTLY" });
  assert.equal(statusForScore(r), "disqualified");
});
