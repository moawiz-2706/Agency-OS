import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFER_KEYS, recommendOffers, type OfferInput } from "../src/offers.js";
import { copyrightYear, detectSignals, type WebsiteSignals } from "../src/signals.js";

const NOW = new Date("2026-11-01T00:00:00Z");

/** A healthy, modern site: books online, has chat and text-us, mobile, current copyright, no ads. */
const good: WebsiteSignals = {
  reachable: true, https: true, mobile_viewport: true, has_form: true,
  has_online_booking: true, booking_tools: ["calendly"], has_chat_widget: true, chat_tools: ["tawk"],
  has_sms_cta: true, has_review_widget: true, has_ad_pixel: false, ad_pixels: [], uses_ghl: false,
  emails_found: [], title: "Acme", copyright_year: 2026,
};
const lead = (signals: Partial<WebsiteSignals> | null, extra: Partial<OfferInput> = {}): OfferInput => ({
  website: "https://acme.example", rating: null, review_count: null,
  signals: signals ? { ...good, ...signals } : null, ...extra,
});
const keys = (c: OfferInput) => recommendOffers(c, NOW).map((o) => o.key);

test("uses exactly the seven agreed offer keys", () => {
  assert.deepEqual(OFFER_KEYS, ["online_booking", "missed_call_textback", "speed_to_lead", "review_automation", "website_gbp", "ghl_optimisation", "fsm_integration"]);
});

test("a healthy site with unknown reviews gets nothing to sell", () => {
  assert.deepEqual(keys(lead({})), []);
});

test("no online booking -> online_booking", () => {
  assert.deepEqual(keys(lead({ has_online_booking: false, booking_tools: [] })), ["online_booking"]);
});

test("no chat and no text-us -> missed_call_textback; either one alone is enough to skip it", () => {
  assert.deepEqual(keys(lead({ has_chat_widget: false, has_sms_cta: false })), ["missed_call_textback"]);
  assert.deepEqual(keys(lead({ has_chat_widget: false })), []);
});

test("ad pixels with no booking and no chat -> speed_to_lead, ranked first", () => {
  const offers = recommendOffers(lead({ has_ad_pixel: true, ad_pixels: ["meta_pixel"], has_online_booking: false, has_chat_widget: false, has_sms_cta: false }), NOW);
  assert.deepEqual(offers.map((o) => o.key), ["speed_to_lead", "online_booking", "missed_call_textback"]);
  assert.match(offers[0].reasons.join(" "), /meta pixel/);
  // Ads but booking in place: no speed-to-lead.
  assert.ok(!keys(lead({ has_ad_pixel: true, ad_pixels: ["google_ads"], has_chat_widget: false })).includes("speed_to_lead"));
});

test("review_automation only when review data exists", () => {
  assert.deepEqual(keys(lead({}, { review_count: 23 })), ["review_automation"]);
  assert.deepEqual(keys(lead({}, { rating: 4.1, review_count: 300 })), ["review_automation"]);
  assert.deepEqual(keys(lead({}, { rating: 4.8, review_count: 300 })), []);
  assert.deepEqual(keys(lead({}, { rating: null, review_count: null })), [], "missing data is not 'few reviews'");
});

test("website_gbp: no site, copyright 2+ years old, or not mobile-friendly", () => {
  assert.deepEqual(keys(lead(null, { website: null })), ["website_gbp"]);
  assert.deepEqual(keys(lead({ copyright_year: 2024 })), ["website_gbp"]);
  assert.deepEqual(keys(lead({ copyright_year: 2025 })), [], "one year old is fine");
  assert.deepEqual(keys(lead({ mobile_viewport: false })), ["website_gbp"]);
});

test("already on GHL -> ghl_optimisation, ranked last", () => {
  const offers = keys(lead({ uses_ghl: true, has_online_booking: false, booking_tools: [] }));
  assert.deepEqual(offers, ["online_booking", "ghl_optimisation"]);
});

test("ServiceTitan / Jobber / Housecall Pro -> fsm_integration", () => {
  const offers = recommendOffers(lead({ booking_tools: ["servicetitan", "jobber"] }), NOW);
  assert.deepEqual(offers.map((o) => o.key), ["fsm_integration"]);
  assert.deepEqual(offers[0].reasons, ["Uses ServiceTitan, Jobber"]);
});

test("an unreachable or failed audit gives no site-based offers", () => {
  assert.deepEqual(keys(lead({ reachable: false, has_online_booking: false })), []);
  assert.deepEqual(keys(lead(null)), []);
});

test("copyright year: newest year in a notice, ranges, entities; ignores other years", () => {
  assert.equal(copyrightYear("<footer>&copy; 2015 - 2021 Acme HVAC</footer>", NOW), 2021);
  assert.equal(copyrightYear("<p>Copyright 2019. Serving since 1998.</p>", NOW), 2019);
  assert.equal(copyrightYear("<p>© 2026 Acme</p>", NOW), 2026);
  assert.equal(copyrightYear("<p>Founded 2010. Call 1-800-555-2020</p>", NOW), null);
  assert.equal(detectSignals("<footer>©2018 Old Roofing Co</footer>", "https://x.example").copyright_year, 2018);
});
