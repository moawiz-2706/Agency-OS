// Write lead batches for external AI research (docs/research/README.md).
//
// Usage: node scripts/export-research.mjs [--limit 200] [--batch-size 20] [--include-researched]
//
// Writes data/research/batches/batch_NN.csv (the columns RESEARCH_PROMPT.md expects)
// and _hints.csv (audit signals + top recommended offer per lead). Leads without a
// research report come first, then leads with a website, then highest score.
// Disqualified and do-not-contact leads are skipped. data/ is gitignored.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { admin, chunk, must, root, selectAll } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  return Number(args[i].includes("=") ? args[i].split("=")[1] : args[i + 1]);
};
const limit = opt("limit", 200);
const batchSize = opt("batch-size", 20);
const includeResearched = args.includes("--include-researched");
if (!(limit > 0) || !(batchSize > 0)) {
  console.error("Usage: node scripts/export-research.mjs [--limit 200] [--batch-size 20] [--include-researched]");
  process.exit(1);
}

const db = admin();
const outDir = path.join(root, "data", "research", "batches");

const companies = await selectAll(() => db.from("companies")
  .select("id,lead_ref,name,trade,website,phone,email,city,region,country,facebook,instagram,score,stage,status,recommended_offers")
  .not("lead_ref", "is", null)
  .not("stage", "eq", "disqualified")
  .not("status", "in", "(disqualified,do_not_contact)")
  .order("id"));
const researched = new Set((await selectAll(() => db.from("research_reports").select("company_id").order("id"))).map((r) => r.company_id));

const picked = companies
  .filter((c) => includeResearched || !researched.has(c.id))
  .sort((a, b) =>
    Number(researched.has(a.id)) - Number(researched.has(b.id))   // not yet researched first
    || Number(!a.website) - Number(!b.website)                     // then leads with a website
    || (b.score ?? -1) - (a.score ?? -1)                           // then highest score
    || a.lead_ref.localeCompare(b.lead_ref))
  .slice(0, limit);

if (!picked.length) {
  console.log(includeResearched ? "No leads to export." : "Every lead already has a research report. Use --include-researched to export them again.");
  process.exit(0);
}

// Latest audit per picked lead, for the hints file.
const audits = new Map();
for (const part of chunk(picked.map((c) => c.id))) {
  const rows = must(await db.from("website_audits").select("company_id,signals,error,fetched_at").in("company_id", part).order("fetched_at", { ascending: false }));
  for (const a of rows) if (!audits.has(a.company_id)) audits.set(a.company_id, a);
}

const esc = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
};
const csv = (header, rows) => [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
const yn = (v) => (v === true ? "yes" : v === false ? "no" : "unknown");

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (/^batch_\d+\.csv$|^_hints\.csv$/.test(f)) rmSync(path.join(outDir, f));

const BATCH_COLS = ["lead_id", "name", "trade", "website", "phone", "email", "city", "state_province", "country", "facebook", "instagram"];
const batches = chunk(picked, batchSize);
const pad = String(batches.length).length < 2 ? 2 : String(batches.length).length;
batches.forEach((rows, i) => {
  const file = `batch_${String(i + 1).padStart(pad, "0")}.csv`;
  writeFileSync(path.join(outDir, file), csv(BATCH_COLS, rows.map((c) =>
    [c.lead_ref, c.name, c.trade, c.website, c.phone, c.email, c.city, c.region, c.country, c.facebook, c.instagram])));
});

const HINT_COLS = ["lead_id", "audit", "online_booking", "chat", "text_us", "ad_pixels", "uses_ghl", "booking_tools", "mobile_friendly", "copyright_year", "top_offer", "offer_reasons"];
writeFileSync(path.join(outDir, "_hints.csv"), csv(HINT_COLS, picked.map((c) => {
  const a = audits.get(c.id);
  const s = a && !a.error ? a.signals ?? {} : null;
  const top = c.recommended_offers?.[0];
  return [
    c.lead_ref, a ? (a.error ? `failed: ${a.error.slice(0, 60)}` : "ok") : "not audited",
    s ? yn(s.has_online_booking) : "", s ? yn(s.has_chat_widget) : "", s ? yn(s.has_sms_cta) : "",
    s ? (s.ad_pixels ?? []).join(" | ") : "", s ? yn(s.uses_ghl) : "", s ? (s.booking_tools ?? []).join(" | ") : "",
    s ? yn(s.mobile_viewport) : "", s?.copyright_year ?? "", top?.key ?? "", (top?.reasons ?? []).join(" | "),
  ];
})));

const withSite = picked.filter((c) => c.website).length;
console.log(`Exported ${picked.length} lead(s) in ${batches.length} batch(es) of up to ${batchSize}:
  ${path.relative(root, outDir)}${path.sep}batch_${"1".padStart(pad, "0")}.csv … batch_${String(batches.length).padStart(pad, "0")}.csv
  ${path.relative(root, outDir)}${path.sep}_hints.csv
  ${withSite} with a website, ${picked.length - withSite} without; ${picked.filter((c) => researched.has(c.id)).length} already researched.
Next: paste docs/research/RESEARCH_PROMPT.md + one batch into an AI tool with web access (see docs/research/README.md).`);
