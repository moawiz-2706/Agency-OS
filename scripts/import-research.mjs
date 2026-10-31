// Import lead research done with an external AI tool (docs/research/README.md).
//
// Usage: node scripts/import-research.mjs data/research/results_01.csv [--dry-run]
//
// The file must use the results_TEMPLATE.csv header (43 columns). Rows are matched
// on lead_id -> companies.lead_ref. Gaps without an evidence URL are dropped; a row
// is rejected if no gap survives (unless the business is closed or its site is down)
// or it names an unknown offer key. Re-importing a file updates the lead's latest
// external_ai report instead of adding another. Exits 1 if any row was rejected.
// Needs `pnpm build` once so @agencyos/core is compiled.
import { readFileSync } from "node:fs";
import path from "node:path";
import "./lib.mjs";   // loads .env before core connects
import { importResearchCsv } from "@agencyos/core";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
if (!file) {
  console.error("Usage: node scripts/import-research.mjs <results.csv> [--dry-run]");
  process.exit(1);
}

let r;
try {
  r = await importResearchCsv(readFileSync(file, "utf8"), { sourceName: path.basename(file), dryRun });
} catch (e) {
  console.error(`Import failed: ${e.message}`);
  process.exit(1);
}

const list = (items, fmt) => items.map((x) => `    ${fmt(x)}`).join("\n");
console.log(`${r.file}: ${r.rows} row(s)${dryRun ? "  (dry run, nothing saved)" : ""}

imported:        ${r.imported}${r.repaired ? `  (${r.repaired} of them realigned after a slipped gap column)` : ""}
updated:         ${r.updated}${r.updated ? "  (re-import: latest external research replaced)" : ""}
skipped:         ${r.skipped.length}${r.skipped.length ? "\n" + list(r.skipped, (s) => `${s.lead_id}: ${s.reason}`) : ""}
rejected:        ${r.rejected.length}${r.rejected.length ? "\n" + list(r.rejected, (s) => `${s.lead_id}: ${s.reason}`) : ""}
contacts added:  ${r.contacts_added}${r.do_not_contact ? `  (${r.do_not_contact} marked do-not-contact: "no unsolicited email" notice)` : ""}
disqualified:    ${r.disqualified.length}${r.disqualified.length ? `  (closed per research: ${r.disqualified.join(", ")})` : ""}`);
if (r.notes.length) console.log(`\nnotes:\n${list(r.notes, (n) => n)}`);

if (r.rejected.length) {
  console.error(`\n${r.rejected.length} row(s) rejected. Fix them in the CSV (or re-research) and import again; accepted rows are ${dryRun ? "not saved in a dry run" : "already saved"}.`);
  process.exit(1);
}
