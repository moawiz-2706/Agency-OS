import { test } from "node:test";
import assert from "node:assert/strict";
import { toPlace } from "../src/google-places.js";
import { normalizeDomain } from "../src/lead-source.js";
import { safeFetch } from "../src/web-fetch.js";

test("place mapping + domain normalisation", () => {
  const p = toPlace({
    id: "abc", displayName: { text: "Acme" }, websiteUri: "https://www.AcmeHVAC.com/home",
    addressComponents: [
      { longText: "Dallas", shortText: "Dallas", types: ["locality"] },
      { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1"] },
      { longText: "United States", shortText: "US", types: ["country"] },
    ],
  } as any);
  assert.equal(p.city, "Dallas"); assert.equal(p.region, "TX"); assert.equal(p.country, "US");
  assert.equal(p.website_domain, "acmehvac.com");
  assert.equal(normalizeDomain("not a url"), null);
});

test("SSRF guard blocks private addresses", async () => {
  for (const u of ["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest", "file:///etc/passwd", "http://10.0.0.5:8080/"]) {
    await assert.rejects(safeFetch(u, { userAgent: "test" }), `${u} should be blocked`);
  }
});
