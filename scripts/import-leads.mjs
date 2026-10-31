// Import or refresh leads from a CSV (base or enriched export).
//
// Usage: node scripts/import-leads.mjs data/agencyos-leads-1000.csv [--assign=region|even|none] [--dry-run]
//
// Matching: lead_id -> lead_ref, then osm_id. Leads saved before they had a
// lead_ref (the earlier MCP import) are matched by website domain, phone, or
// name + region, and get their lead_ref filled in. Re-importing updates the data
// columns only: owner, stage, touches, notes and history are never changed, and
// empty cells never blank out existing values.
//
// Owners are only set on leads that have none: --assign=region gives the owner
// ASSIGN_REGIONS_A (default ON,AB,BC,AZ,TX) and the first partner the rest.
import { readFileSync } from "node:fs";
import path from "node:path";
import { admin, chunk, env, must, parseCsv, selectAll } from "./lib.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const assign = (args.find((a) => a.startsWith("--assign=")) ?? "--assign=region").split("=")[1];
if (!file || !["region", "even", "none"].includes(assign)) {
  console.error("Usage: node scripts/import-leads.mjs <csv> [--assign=region|even|none] [--dry-run]");
  process.exit(1);
}
const regionsA = new Set(env("ASSIGN_REGIONS_A", "ON,AB,BC,AZ,TX").split(",").map((r) => r.trim().toUpperCase()));

const db = admin();
const { headers, records } = parseCsv(readFileSync(file, "utf8"));
const fileName = path.basename(file);
console.log(`${fileName}: ${records.length} rows${dryRun ? "  (dry run, nothing is saved)" : ""}`);

// ---------- column mapping ----------
// Columns that land in their own field. Anything else goes into companies.enrichment.
const MAPPED = new Set([
  "lead_id", "name", "trade", "phone", "website", "domain", "email", "best_email", "street", "unit", "city",
  "state_province", "postal_code", "country", "time_zone", "lat", "lng", "opening_hours", "facebook", "instagram",
  "linkedin", "yelp", "is_chain_or_franchise", "data_license", "osm_id", "lead_score", "lead_tier", "score_reasons",
  "status", "source",
]);
const extraCols = headers.filter((h) => !MAPPED.has(h));

const clean = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const nicheKey = (v) => v?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || null;
const digits10 = (p) => { const d = (p ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : null; };
const domainOf = (r) => {
  const raw = clean(r.domain) ?? clean(r.website);
  if (!raw) return null;
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return null; }
};
const num = (v) => { const n = Number(clean(v)); return clean(v) !== null && Number.isFinite(n) ? n : null; };
const tierOf = (t, score) => {
  const v = clean(t)?.toLowerCase();
  if (["high", "medium", "low"].includes(v)) return v;
  if (score == null) return null;
  return score >= 70 ? "high" : score >= 50 ? "medium" : "low";
};
const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;

function toCompany(r) {
  const address = [clean(r.street), clean(r.unit) && `Unit ${clean(r.unit)}`].filter(Boolean).join(", ") || null;
  const score = num(r.lead_score);
  const enrichment = {};
  for (const k of extraCols) if (clean(r[k]) !== null) enrichment[k] = clean(r[k]);
  const rawEmail = (clean(r.best_email) ?? clean(r.email))?.toLowerCase().split(/[;,\s]+/)[0] ?? null;
  return {
    lead_ref: clean(r.lead_id),
    osm_id: clean(r.osm_id),
    name: clean(r.name),
    trade: clean(r.trade),
    niche: nicheKey(clean(r.trade)),
    phone: clean(r.phone),
    website: clean(r.website),
    website_domain: domainOf(r),
    email: rawEmail && EMAIL_RE.test(rawEmail) ? rawEmail : null,
    address,
    city: clean(r.city),
    region: clean(r.state_province)?.toUpperCase() ?? null,
    postal_code: clean(r.postal_code),
    country: ["US", "CA"].includes(clean(r.country)?.toUpperCase()) ? clean(r.country).toUpperCase() : null,
    time_zone: clean(r.time_zone),
    lat: num(r.lat),
    lng: num(r.lng),
    opening_hours: clean(r.opening_hours),
    facebook: clean(r.facebook),
    instagram: clean(r.instagram),
    linkedin: clean(r.linkedin),
    yelp: clean(r.yelp),
    is_chain: clean(r.is_chain_or_franchise) ? /^(yes|true|likely|1)/i.test(r.is_chain_or_franchise) : null,
    data_license: clean(r.data_license),
    ...(score != null && {
      score: Math.max(0, Math.min(100, Math.round(score))),
      tier: tierOf(r.lead_tier, score),
      score_breakdown: { reasons: (clean(r.score_reasons) ?? "").split(/\s*[;|]\s*/).filter(Boolean).map((reason) => ({ reason })), source: fileName },
    }),
    _enrichment: enrichment,
    _row: r,
  };
}

/** CASL: implied consent only when the business publishes the address itself and hasn't said no. */
function consentFor(c) {
  if (c.country === "US") return { basis: "can_spam_b2b", published: false };
  const r = c._row;
  const own = /^yes/i.test(clean(r.email_published_on_own_site) ?? "");
  const noNotice = !clean(r.no_unsolicited_email_notice);
  if (c.country === "CA" && own && noNotice) return { basis: "casl_implied_published", published: true };
  return { basis: "unknown", published: false };
}

// ---------- load what's already there ----------
const team = must(await db.from("team_members").select("id,email,role,full_name").eq("active", true).order("created_at"));
const owner = team.find((m) => m.role === "owner");
const partner = team.find((m) => m.role === "partner") ?? owner;
if (assign !== "none" && !owner) {
  console.error("No team members yet. Run `node scripts/setup-team.mjs` first, or use --assign=none.");
  process.exit(1);
}

const existing = await selectAll(() =>
  db.from("companies").select("id,lead_ref,osm_id,website_domain,phone_digits,name,region,owner_id,enrichment").order("id"));
const byRef = new Map(), byOsm = new Map(), byNameRegion = new Map(), byDomain = new Map(), byPhone = new Map();
const push = (m, k, v) => { if (k) m.set(k, [...(m.get(k) ?? []), v]); };
for (const c of existing) {
  if (c.lead_ref) byRef.set(c.lead_ref, c);
  if (c.osm_id) byOsm.set(c.osm_id, c);
  if (!c.lead_ref) {   // fallbacks only for rows not yet tied to a lead_ref
    push(byNameRegion, `${c.name?.toLowerCase()}|${c.region}`, c);
    push(byDomain, c.website_domain, c);
    push(byPhone, c.phone_digits, c);
  }
}
// Exact keys first; then name + region (the same business from an earlier import),
// then domain and phone. A row can only be matched once, so chain branches that
// share a website or phone don't collapse into one lead.
const claimed = new Set();
const match = (c) => {
  const candidates = [
    c.lead_ref && byRef.get(c.lead_ref),
    c.osm_id && byOsm.get(c.osm_id),
    ...(byNameRegion.get(`${c.name?.toLowerCase()}|${c.region}`) ?? []),
    ...(byDomain.get(c.website_domain) ?? []),
    ...(byPhone.get(digits10(c.phone)) ?? []),
  ];
  const hit = candidates.find((x) => x && !claimed.has(x.id));
  if (hit) claimed.add(hit.id);
  return hit ?? null;
};

// ---------- plan ----------
let evenTurn = 0;
const ownerFor = (c) => {
  if (assign === "none") return null;
  if (assign === "even") return (evenTurn++ % 2 === 0 ? owner : partner).id;
  return regionsA.has(c.region ?? "") ? owner.id : partner.id;
};

const inserts = [], updates = [], skipped = [];
for (const r of records) {
  const c = toCompany(r);
  if (!c.name) { skipped.push(`${c.lead_ref ?? "?"}: no name`); continue; }
  const hit = match(c);
  if (hit) updates.push({ c, hit });
  else inserts.push(c);
}

const strip = ({ _enrichment, _row, ...rest }) => Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
const assignedCount = { [owner?.full_name ?? "owner"]: 0, [partner?.full_name ?? "partner"]: 0 };
const countOwner = (id) => { const m = team.find((t) => t.id === id); if (m) assignedCount[m.full_name] = (assignedCount[m.full_name] ?? 0) + 1; };

console.log(`plan: insert ${inserts.length}, update ${updates.length}, skip ${skipped.length}${extraCols.length ? `; enrichment columns: ${extraCols.join(", ")}` : ""}`);

// ---------- write ----------
const idFor = new Map();   // lead_ref/name -> company id, for contacts
let inserted = 0, updated = 0;

if (!dryRun) {
  for (const part of chunk(inserts)) {
    const rows = part.map((c) => {
      const owner_id = ownerFor(c);
      if (owner_id) countOwner(owner_id);
      return { ...strip(c), enrichment: c._enrichment, source: "csv", owner_id, stage: "new" };
    });
    const saved = must(await db.from("companies").insert(rows).select("id"));
    saved.forEach((s, i) => idFor.set(part[i], s.id));
    inserted += saved.length;
  }

  // Updates one by one (each row sets different columns); a few at a time.
  for (const part of chunk(updates, 10)) {
    await Promise.all(part.map(async ({ c, hit }) => {
      const patch = { ...strip(c), enrichment: { ...(hit.enrichment ?? {}), ...c._enrichment } };
      if (!hit.owner_id) { const id = ownerFor(c); if (id) { patch.owner_id = id; countOwner(id); } }
      must(await db.from("companies").update(patch).eq("id", hit.id));
      idFor.set(c, hit.id);
      updated++;
    }));
  }
} else {
  for (const c of inserts) { const id = ownerFor(c); if (id) countOwner(id); }
  for (const { c, hit } of updates) if (!hit.owner_id) { const id = ownerFor(c); if (id) countOwner(id); }
}

// ---------- contacts: one primary contact per lead with an email ----------
const withEmail = [...inserts, ...updates.map((u) => u.c)].filter((c) => c.email);
const suppressed = new Set((await selectAll(() => db.from("suppressions").select("email,domain").order("id")))
  .flatMap((s) => [s.email?.toLowerCase(), s.domain && `@${s.domain.toLowerCase()}`]).filter(Boolean));
const haveContact = new Set((await selectAll(() => db.from("contacts").select("company_id,email").not("email", "is", null).order("id")))
  .map((c) => `${c.company_id}|${c.email.toLowerCase()}`));

let contactsAdded = 0, contactsExisting = 0, contactsSuppressed = 0, caUnknown = 0;
const newContacts = [];
for (const c of withEmail) {
  if (suppressed.has(c.email) || suppressed.has(`@${c.email.split("@")[1]}`)) { contactsSuppressed++; continue; }
  const companyId = dryRun ? null : idFor.get(c);
  if (!dryRun && !companyId) continue;
  const key = `${companyId}|${c.email}`;
  if (!dryRun && haveContact.has(key)) {
    // Contact already there: refresh consent if this file now proves a CASL basis.
    const consent = consentFor(c);
    if (consent.basis !== "unknown") {
      must(await db.from("contacts").update({ consent_basis: consent.basis, email_published_publicly: consent.published })
        .eq("company_id", companyId).ilike("email", c.email).eq("consent_basis", "unknown"));
    }
    contactsExisting++;
    continue;
  }
  haveContact.add(key);
  const consent = consentFor(c);
  if (c.country === "CA" && consent.basis === "unknown") caUnknown++;
  const r = c._row;
  newContacts.push({
    company_id: companyId,
    email: c.email,
    source: `csv:${fileName}`,
    source_url: clean(r.email_source_url) ?? clean(r.email_found_on) ?? clean(r.osm_url),
    email_published_publicly: consent.published,
    consent_basis: consent.basis,
    email_is_role: /^(info|office|contact|admin|sales|service|hello|support|team|booking|dispatch)@/.test(c.email),
  });
}
if (!dryRun) {
  for (const part of chunk(newContacts)) contactsAdded += must(await db.from("contacts").insert(part).select("id")).length;
  must(await db.from("activities").insert({
    type: "csv_imported", actor: "system",
    payload: { file: fileName, inserted, updated, skipped: skipped.length, contacts_added: contactsAdded },
  }));
} else {
  contactsAdded = newContacts.length;
}

console.log(`
inserted:           ${dryRun ? inserts.length : inserted}
updated:            ${dryRun ? updates.length : updated}
skipped:            ${skipped.length}${skipped.length ? `  (${skipped.slice(0, 5).join("; ")})` : ""}
contacts added:     ${contactsAdded}${dryRun ? " (would add, if not already present)" : ""}
contacts existing:  ${contactsExisting}
contacts suppressed:${contactsSuppressed}
CA emails without a CASL basis (saved, not sendable): ${caUnknown}
owners assigned:    ${Object.entries(assignedCount).map(([n, k]) => `${n} ${k}`).join(", ")}${assign === "none" ? " (--assign=none)" : ""}
`);
