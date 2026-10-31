import { test } from "node:test";
import assert from "node:assert/strict";
import { mapHeaders, normalizePhone, parseCsv, toImportRow } from "../src/csv.js";
import { countryForRegion, regionCode, timezoneFor } from "../src/geo.js";

test("CSV parser handles quotes, commas, newlines in fields and a BOM", () => {
  const rows = parseCsv('﻿name,notes\r\n"Acme, Inc","says ""hi""\nline 2"\r\n\r\nBeta,x\n');
  assert.deepEqual(rows, [["name", "notes"], ["Acme, Inc", 'says "hi"\nline 2'], ["Beta", "x"]]);
});

test("headers map from common export formats", () => {
  const maps = mapHeaders(["Company Name", "Website", "Phone Number", "Email Address", "First Name", "Last Name", "Job Title", "State", "Zip Code"]);
  assert.deepEqual(maps, { company: 0, website: 1, phone: 2, email: 3, first_name: 4, last_name: 5, role: 6, region: 7, postal_code: 8 });

  // "name" alone is the business; next to a company column it's the person.
  assert.equal(mapHeaders(["name", "website"]).company, 0);
  const both = mapHeaders(["Company", "Name", "Email"]);
  assert.equal(both.company, 0);
  assert.equal(both.full_name, 1);

  // "title" is the business in a Maps export, but a job title next to a person.
  assert.equal(mapHeaders(["title", "phone"]).company, 0);
  const person = mapHeaders(["first name", "title", "company"]);
  assert.equal(person.role, 1);
  assert.equal(person.company, 2);
});

test("a row becomes a company and contact with normalised fields", () => {
  const headers = ["Company", "Website", "Phone", "Email", "Contact Name", "City", "State", "Reviews", "Rating"];
  const cols = mapHeaders(headers);
  const r = toImportRow(["Acme HVAC", "www.AcmeHVAC.com/", "+1 (214) 555-0100", "Mike@AcmeHVAC.com; info@acmehvac.com", "Mike Smith", "Dallas", "Texas", "23", "4.1"], cols, 2, {});
  assert.ok(!("skip" in r));
  assert.equal(r.company.website, "https://www.AcmeHVAC.com/");
  assert.equal(r.company.website_domain, "acmehvac.com");
  assert.equal(r.company.phone_digits, "2145550100");
  assert.equal(r.company.region, "TX");
  assert.equal(r.company.country, "US");
  assert.equal(r.company.time_zone, "America/Chicago");
  assert.equal(r.company.review_count, 23);
  assert.equal(r.contact.email, "mike@acmehvac.com");
  assert.equal(r.contact.full_name, "Mike Smith");
});

test("rows without a name or website are skipped; bad emails are flagged", () => {
  const cols = mapHeaders(["Company", "Website", "Email"]);
  assert.deepEqual(toImportRow(["", "", "a@b.com"], cols, 5, {}), { line: 5, skip: "no business name or website" });
  const r = toImportRow(["", "roofco.ca", "not-an-email"], cols, 6, { country: "CA" });
  assert.ok(!("skip" in r));
  assert.equal(r.company.name, "roofco.ca");
  assert.equal(r.company.country, "CA");
  assert.equal(r.contact.email, null);
  assert.equal(r.contact.email_raw, "not-an-email");
});

test("phones and regions normalise", () => {
  assert.equal(normalizePhone("(214) 555-0100"), normalizePhone("+1 214.555.0100"));
  assert.equal(normalizePhone("555-0100"), null);
  assert.equal(regionCode("ontario"), "ON");
  assert.equal(countryForRegion("ON"), "CA");
  assert.equal(countryForRegion("CA"), "US"); // California, not Canada
  assert.equal(timezoneFor("CA", "AB"), "America/Edmonton");
});
