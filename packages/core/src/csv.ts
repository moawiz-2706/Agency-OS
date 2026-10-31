import { normalizeDomain } from "@agencyos/adapters";
import { countryCode, countryForRegion, regionCode, timezoneFor } from "./geo.js";

/** RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

// Header names seen in exports from Google Maps scrapers, Apollo, Outscraper, D7, Excel.
// Compared after lowercasing and dropping everything but letters and digits.
const ALIASES: Record<string, string[]> = {
  company: ["company", "companyname", "business", "businessname", "organization", "organisation", "account", "accountname"],
  website: ["website", "url", "websiteurl", "site", "domain", "companywebsite", "web", "companydomain"],
  phone: ["phone", "phonenumber", "companyphone", "mainphone", "telephone", "tel", "businessphone", "phone1"],
  email: ["email", "emailaddress", "contactemail", "workemail", "businessemail", "email1", "emails"],
  first_name: ["firstname", "first", "fname", "contactfirstname"],
  last_name: ["lastname", "last", "lname", "contactlastname"],
  full_name: ["fullname", "contactname", "contact", "ownername", "owner", "personname"],
  role: ["jobtitle", "role", "position", "contacttitle"],
  contact_phone: ["mobile", "mobilephone", "directphone", "contactphone", "cell", "cellphone"],
  address: ["address", "street", "streetaddress", "address1", "fulladdress"],
  city: ["city", "town", "locality"],
  region: ["state", "region", "province", "stateprovince", "st", "statecode"],
  country: ["country", "countrycode"],
  postal_code: ["zip", "zipcode", "postalcode", "postcode", "postal"],
  niche: ["niche", "trade", "category", "industry", "type", "businesstype", "maincategory"],
  timezone: ["timezone", "tz"],
  lat: ["lat", "latitude"],
  lng: ["lng", "lon", "long", "longitude"],
  rating: ["rating", "googlerating", "stars", "averagerating"],
  review_count: ["reviews", "reviewcount", "numberofreviews", "googlereviews", "userratingcount", "reviewscount"],
  google_place_id: ["placeid", "googleplaceid"],
  source_url: ["sourceurl", "emailsource", "foundon", "emailsourceurl"],
};

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which column holds which field. "name" means the business unless another column already does. */
export function mapHeaders(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  headers.forEach((h, i) => {
    const k = key(h);
    for (const [field, names] of Object.entries(ALIASES)) {
      if (out[field] === undefined && names.includes(k)) { out[field] = i; return; }
    }
  });
  const nameCol = headers.findIndex((h) => key(h) === "name");
  if (nameCol >= 0) {
    if (out.company === undefined) out.company = nameCol;
    else if (out.full_name === undefined) out.full_name = nameCol;
  }
  // "title" is a job title next to a person's name, otherwise the business name (Maps exports).
  const titleCol = headers.findIndex((h) => key(h) === "title");
  if (titleCol >= 0) {
    const hasPerson = out.first_name !== undefined || out.last_name !== undefined || out.full_name !== undefined;
    if (hasPerson || out.company !== undefined) out.role ??= titleCol;
    else out.company = titleCol;
  }
  return out;
}

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function isValidEmailSyntax(email: string): boolean {
  return EMAIL_RE.test(email) && !email.includes("..") && email.length <= 254;
}

const num = (v?: string) => {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && v.trim() !== "" ? n : null;
};

const coord = (v?: string) => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "Pest control" -> "pest_control", matching the niche preset keys. */
export const nicheKey = (v?: string) => v?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || null;

export type ImportRow = {
  line: number;
  company: {
    name: string;
    website: string | null;
    website_domain: string | null;
    phone: string | null;
    phone_digits: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
    country: "US" | "CA" | null;
    postal_code: string | null;
    lat: number | null;
    lng: number | null;
    timezone: string | null;
    niche: string | null;
    rating: number | null;
    review_count: number | null;
    google_place_id: string | null;
  };
  contact: {
    full_name: string | null;
    role: string | null;
    email: string | null;
    email_raw: string | null;   // what the file said, when it failed the syntax check
    phone: string | null;
    source_url: string | null;
  };
};

/** One CSV line -> a company and (maybe) a contact. Returns null with a reason when unusable. */
export function toImportRow(
  cells: string[],
  cols: Record<string, number>,
  line: number,
  defaults: { country?: "US" | "CA"; niche?: string },
): ImportRow | { line: number; skip: string } {
  const get = (f: string) => {
    const i = cols[f];
    const v = i === undefined ? "" : (cells[i] ?? "").trim();
    return v === "" ? undefined : v;
  };

  let website = get("website") ?? null;
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website.replace(/^\/+/, "")}`;
  const domain = normalizeDomain(website);
  if (!domain) website = null;

  // Some exports put several emails in one cell; take the first.
  const emailRaw = get("email")?.split(/[;,\s]+/).find(Boolean)?.toLowerCase().replace(/^mailto:/, "") ?? null;
  const email = emailRaw && isValidEmailSyntax(emailRaw) ? emailRaw : null;

  const name = get("company") ?? domain ?? null;
  if (!name) return { line, skip: "no business name or website" };

  const region = regionCode(get("region")) ?? get("region")?.toUpperCase() ?? null;
  const country = countryCode(get("country")) ?? countryForRegion(regionCode(get("region"))) ?? defaults.country ?? null;
  const phone = get("phone") ?? null;

  const first = get("first_name"), last = get("last_name");
  const fullName = get("full_name") ?? ([first, last].filter(Boolean).join(" ") || null);

  return {
    line,
    company: {
      name,
      website,
      website_domain: domain,
      phone,
      phone_digits: normalizePhone(phone),
      address: get("address") ?? null,
      city: get("city") ?? null,
      region,
      country,
      postal_code: get("postal_code") ?? null,
      lat: coord(get("lat")),
      lng: coord(get("lng")),
      timezone: (get("timezone")?.includes("/") ? get("timezone") : null) ?? timezoneFor(country, region),
      niche: defaults.niche ?? nicheKey(get("niche")),
      rating: num(get("rating")),
      review_count: num(get("review_count")),
      google_place_id: get("google_place_id") ?? null,
    },
    contact: {
      full_name: fullName,
      role: get("role") ?? null,
      email,
      email_raw: emailRaw && !email ? emailRaw : null,
      phone: get("contact_phone") ?? null,
      source_url: get("source_url") ?? null,
    },
  };
}
