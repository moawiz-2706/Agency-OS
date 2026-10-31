import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { db, logActivities, must } from "@agencyos/db";
import { consentForImport, isRoleAddress } from "./compliance.js";
import type { ConsentBasis } from "./config.js";
import { mapHeaders, parseCsv, toImportRow, type ImportRow } from "./csv.js";
import { scoreLead, statusForScore } from "./scoring.js";

const MAX_BYTES = 10_000_000;
const MAX_ROWS = 10_000;
const CHUNK = 200;

export type ImportOptions = {
  file_path?: string;
  csv_text?: string;
  niche?: string;                 // overrides the file's category column
  default_country?: "US" | "CA";  // for rows that don't say and have no state/province
  us_consent?: ConsentBasis;      // basis recorded for US emails (default can_spam_b2b)
  dry_run?: boolean;
};

const chunks = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

/** Look up existing companies by each dedupe key, in chunks. */
async function existingBy(column: string, values: string[]) {
  const found = new Map<string, string>();
  for (const part of chunks([...new Set(values)])) {
    if (!part.length) continue;
    const rows = must(await db().from("companies").select(`id,${column}`).in(column, part)) as any[];
    for (const r of rows) if (r[column]) found.set(r[column], r.id);
  }
  return found;
}

/**
 * Import a CSV of businesses and contacts. Companies dedupe on Google place ID,
 * then website domain, then phone, against the database and within the file.
 * Contacts dedupe per company on email, skip suppressed addresses, and get a
 * consent basis by country (see consentForImport).
 */
export async function importLeadsCsv(opts: ImportOptions) {
  let text = opts.csv_text;
  let sourceName = "pasted.csv";
  if (opts.file_path) {
    const st = await stat(opts.file_path);
    if (st.size > MAX_BYTES) throw new Error(`File is ${(st.size / 1e6).toFixed(1)} MB; the limit is 10 MB. Split it.`);
    text = await readFile(opts.file_path, "utf8");
    sourceName = path.basename(opts.file_path);
  }
  if (!text) throw new Error("Give file_path (a CSV on this PC) or csv_text");

  const table = parseCsv(text);
  if (table.length < 2) throw new Error("The CSV has no data rows");
  if (table.length - 1 > MAX_ROWS) throw new Error(`${table.length - 1} rows; the limit is ${MAX_ROWS} per import. Split the file.`);

  const [headers, ...data] = table;
  const cols = mapHeaders(headers);
  if (cols.company === undefined && cols.website === undefined) {
    throw new Error(`Couldn't find a business name or website column. Headers seen: ${headers.join(", ")}`);
  }

  const skipped: { line: number; reason: string }[] = [];
  const rows: ImportRow[] = [];
  data.forEach((cells, i) => {
    const r = toImportRow(cells, cols, i + 2, { country: opts.default_country, niche: opts.niche });
    if ("skip" in r) skipped.push({ line: r.line, reason: r.skip });
    else rows.push(r);
  });

  // ---- companies: match against the database ----
  const byPlace = await existingBy("google_place_id", rows.flatMap((r) => r.company.google_place_id ?? []));
  const byDomain = await existingBy("website_domain", rows.flatMap((r) => r.company.website_domain ?? []));
  const byPhone = await existingBy("phone_digits", rows.flatMap((r) => r.company.phone_digits ?? []));

  // ---- and within the file: every row gets a company key ----
  const fileKeys = new Map<string, number>();     // dedupe key -> index into newCompanies
  const newCompanies: ImportRow["company"][] = [];
  const rowCompany: ({ existing: string } | { fresh: number })[] = [];
  let matchedExisting = 0, duplicatesInFile = 0;

  for (const r of rows) {
    const c = r.company;
    const existing = (c.google_place_id && byPlace.get(c.google_place_id))
      || (c.website_domain && byDomain.get(c.website_domain))
      || (c.phone_digits && byPhone.get(c.phone_digits));
    if (existing) { rowCompany.push({ existing }); matchedExisting++; continue; }

    const keys = [c.google_place_id && `p:${c.google_place_id}`, c.website_domain && `d:${c.website_domain}`, c.phone_digits && `t:${c.phone_digits}`]
      .filter(Boolean) as string[];
    const hit = keys.map((k) => fileKeys.get(k)).find((v) => v !== undefined);
    if (hit !== undefined) {
      rowCompany.push({ fresh: hit });
      duplicatesInFile++;
      keys.forEach((k) => fileKeys.set(k, hit));
      continue;
    }
    const idx = newCompanies.push(c) - 1;
    keys.forEach((k) => fileKeys.set(k, idx));
    rowCompany.push({ fresh: idx });
  }

  const scored = newCompanies.map((c) => {
    const s = scoreLead({ business_status: null, phone: c.phone, website: c.website, rating: c.rating, review_count: c.review_count, signals: null });
    return { c, s };
  });
  const countryMissing = newCompanies.filter((c) => !c.country).length;

  // ---- contacts ----
  type NewContact = { row: ImportRow; companyRef: { existing: string } | { fresh: number } };
  const contactRows: NewContact[] = [];
  let noContact = 0, invalidEmail = 0;
  rows.forEach((r, i) => {
    if (r.contact.email_raw) invalidEmail++;
    if (!r.contact.email && !r.contact.full_name) { noContact++; return; }
    contactRows.push({ row: r, companyRef: rowCompany[i] });
  });

  const emails = [...new Set(contactRows.flatMap((c) => c.row.contact.email ?? []))];
  const suppressed = new Set<string>();
  for (const part of chunks(emails)) {
    const domains = [...new Set(part.map((e) => e.split("@")[1]))];
    const rows = must(await db().from("suppressions").select("email,domain").or(
      `email.in.(${part.map((e) => `"${e}"`).join(",")}),domain.in.(${domains.map((d) => `"${d}"`).join(",")})`,
    )) as { email: string | null; domain: string | null }[];
    const supDomains = new Set(rows.flatMap((r) => r.domain?.toLowerCase() ?? []));
    const supEmails = new Set(rows.flatMap((r) => r.email?.toLowerCase() ?? []));
    for (const e of part) if (supEmails.has(e) || supDomains.has(e.split("@")[1])) suppressed.add(e);
  }

  const summary = {
    file: sourceName,
    rows: data.length,
    columns_used: Object.fromEntries(Object.entries(cols).map(([f, i]) => [f, headers[i]])),
    companies_new: newCompanies.length,
    companies_already_in_db: matchedExisting,
    duplicate_rows_in_file: duplicatesInFile,
    companies_without_country: countryMissing,
    new_by_tier: {
      high: scored.filter((x) => x.s.tier === "high").length,
      medium: scored.filter((x) => x.s.tier === "medium").length,
      low: scored.filter((x) => x.s.tier === "low").length,
    },
    contacts_found: contactRows.length,
    emails_invalid: invalidEmail,
    emails_suppressed: suppressed.size,
    rows_without_contact: noContact,
    rows_skipped: skipped.length,
    skipped_examples: skipped.slice(0, 10),
  };

  if (opts.dry_run) return { dry_run: true, ...summary, next_step: "Looks right? Run again without dry_run to save." };

  // ---- write: search run, companies, contacts, activity ----
  const run = must(await db().from("search_runs").insert({
    source: "csv", niche: opts.niche ?? null, query: sourceName, city: null, country: opts.default_country ?? null,
    results_count: data.length, new_count: newCompanies.length,
  }).select("id").single()) as { id: string };

  const now = new Date().toISOString();
  const freshIds: string[] = [];
  for (const part of chunks(scored)) {
    const inserted = must(await db().from("companies").insert(part.map(({ c, s }) => {
      const { phone_digits: _generated, ...cols } = c;   // generated column in the database
      return {
        ...cols,
        source: "csv",
        first_search_run_id: run.id,
        score: s.score,
        tier: s.tier,
        score_breakdown: { reasons: s.reasons, scored_with_audit: false },
        status: statusForScore(s),
      };
    })).select("id")) as { id: string }[];
    freshIds.push(...inserted.map((r) => r.id));
  }
  const companyId = (ref: NewContact["companyRef"]) => ("existing" in ref ? ref.existing : freshIds[ref.fresh]);

  // Skip contacts the database already has (same company + email).
  const companyIds = [...new Set(contactRows.map((c) => companyId(c.companyRef)))];
  const have = new Set<string>();
  for (const part of chunks(companyIds)) {
    const rows = must(await db().from("contacts").select("company_id,email").in("company_id", part).not("email", "is", null)) as any[];
    for (const r of rows) have.add(`${r.company_id}|${String(r.email).toLowerCase()}`);
  }

  const companyCountry = new Map<string, "US" | "CA" | null>();
  const companyDomain = new Map<string, string | null>();
  rows.forEach((r, i) => {
    const id = companyId(rowCompany[i]);
    if (!companyCountry.has(id)) { companyCountry.set(id, r.company.country); companyDomain.set(id, r.company.website_domain); }
  });

  let duplicateContacts = 0, caWithoutBasis = 0;
  const contactInserts: object[] = [];
  for (const { row, companyRef } of contactRows) {
    const cid = companyId(companyRef);
    const email = row.contact.email;
    if (email && suppressed.has(email)) continue;
    if (email) {
      const k = `${cid}|${email}`;
      if (have.has(k)) { duplicateContacts++; continue; }
      have.add(k);
    }
    const country = companyCountry.get(cid) ?? null;
    const consent = consentForImport(country, email, row.contact.source_url, companyDomain.get(cid) ?? null, opts.us_consent);
    if (country === "CA" && email && consent.basis === "unknown") caWithoutBasis++;
    contactInserts.push({
      company_id: cid,
      full_name: row.contact.full_name,
      role: row.contact.role,
      email,
      phone: row.contact.phone,
      source_url: row.contact.source_url,
      source: `csv:${sourceName}`,
      email_published_publicly: consent.published,
      consent_basis: consent.basis,
      email_is_role: email ? isRoleAddress(email) : false,
    });
  }
  let contactsSaved = 0;
  for (const part of chunks(contactInserts)) {
    const inserted = must(await db().from("contacts").insert(part).select("id")) as any[];
    contactsSaved += inserted.length;
  }

  await logActivities([
    ...freshIds.map((id) => ({ company_id: id, type: "discovered", payload: { source: "csv", file: sourceName, search_run_id: run.id } })),
    { company_id: null, type: "csv_imported", payload: { file: sourceName, search_run_id: run.id, companies: freshIds.length, contacts: contactsSaved } },
  ]);

  return {
    ...summary,
    search_run_id: run.id,
    contacts_saved: contactsSaved,
    contacts_already_in_db: duplicateContacts,
    canadian_emails_without_casl_basis: caWithoutBasis,
    next_step: "Run audit_websites to check their sites and refine scores, then verify_email before any outreach.",
  };
}
