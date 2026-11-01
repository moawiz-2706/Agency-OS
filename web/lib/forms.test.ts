// Run: npm test (from web/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins, checkContactForm } from "./forms.ts";

const now = 1_800_000_000_000;
const good = { name: " Darin Jenks ", email: "Darin@Swift.TEST", company: "Swift", website: "swift.test/about", tools: "Jobber", pain: "Calls", started: now - 20_000 };

test("a real enquiry is cleaned up and accepted", () => {
  const r = checkContactForm(good, now);
  assert.equal(r.ok, true);
  if (r.ok === true) assert.deepEqual([r.form.name, r.form.email, r.form.website], ["Darin Jenks", "darin@swift.test", "swift.test/about"]);
});

test("bots are caught by the hidden field or by being too fast; people get clear errors", () => {
  assert.deepEqual(checkContactForm({ ...good, company_url: "http://spam" }, now), { ok: "spam" });
  assert.deepEqual(checkContactForm({ ...good, started: now - 500 }, now), { ok: "spam" });
  assert.deepEqual(checkContactForm({ ...good, name: "" }, now), { ok: false, error: "Please enter your name." });
  assert.equal(checkContactForm({ ...good, email: "darin@" }, now).ok, false);
  assert.equal(checkContactForm({ ...good, website: "not a site" }, now).ok, false);
  assert.equal(checkContactForm({ ...good, website: "" }, now).ok, true);
});

test("only the listed websites may post from the browser", () => {
  assert.deepEqual([...allowedOrigins(undefined)], ["https://thesentinelsystems.com", "https://www.thesentinelsystems.com"]);
  assert.deepEqual([...allowedOrigins(" https://a.test/ , https://b.test")], ["https://a.test", "https://b.test"]);
});
