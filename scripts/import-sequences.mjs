// Load follow-up emails from a sequences markdown file into the CRM as drafts that
// need approval, scheduled per a plan file. Re-running it never duplicates (one row
// per lead + step). Nothing sends until each email is approved on the lead page (or
// "Approve all") and an owner has turned sending on.
//
// Usage: node scripts/import-sequences.mjs <sequences.md> <plan.json> [--dry-run]
//
// sequences.md: "## <lead_ref> · Name" sections with a "**To:** email" line and
// "**Email N: title**" blocks (Email 1 has a "Subject:" line).
// plan.json:
//   { "steps": [2,3,4,5], "time": "07:45", "offsets_days": {"2":5,"3":8,"4":13,"5":19},
//     "start": {"MANUS-004": "2026-11-04", ...},          // day Email 1 went out
//     "time_zones": {"MANUS-007": "America/New_York"} }    // optional; saved on the lead if it has none
// Times are the lead's own time zone. Needs Node 22.18+ (loads web/lib/tz.ts directly).
import { readFileSync } from "node:fs";
import path from "node:path";
import { admin, must } from "./lib.mjs";
import { leadTimeZone, zonedLocalToIso } from "../web/lib/tz.ts";

const args = process.argv.slice(2);
const [mdFile, planFile] = args.filter((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
if (!mdFile || !planFile) {
  console.error("Usage: node scripts/import-sequences.mjs <sequences.md> <plan.json> [--dry-run]");
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planFile, "utf8"));
const steps = plan.steps ?? [2, 3, 4, 5];
const sourceName = path.basename(mdFile);

// ---------- parse ----------
export function parseSequences(md) {
  const out = [];
  for (const section of md.split(/^## /m).slice(1)) {
    const ref = section.match(/^([A-Z]+-\d+)/)?.[1];
    if (!ref) continue;
    const to = section.match(/\*\*To:\*\*\s*([^\s·,;]+@[^\s·,;]+)/)?.[1]?.toLowerCase() ?? null;
    const emails = {};
    const parts = section.split(/^\*\*Email (\d+):[^\n]*\*\*\s*$/m);
    for (let i = 1; i < parts.length; i += 2) {
      let text = parts[i + 1].replace(/\n-{3,}\s*$/m, "").trim();
      let subject = null;
      const sm = text.match(/^Subject:\s*(.+)$/m);
      if (sm) { subject = sm[1].trim(); text = text.replace(sm[0], "").trim(); }
      emails[Number(parts[i])] = { subject, body: text.replace(/\n-{3,}[\s\S]*$/, "").trim() };
    }
    out.push({ ref, to, emails });
  }
  return out;
}

const db = admin();
const sequences = parseSequences(readFileSync(mdFile, "utf8")).filter((s) => plan.start?.[s.ref]);
console.log(`${sourceName}: ${sequences.length} lead(s) in the plan${dryRun ? "  (dry run, nothing saved)" : ""}\n`);

const fmt = (iso, tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const teamTz = process.env.NEXT_PUBLIC_TEAM_TIME_ZONE || "Asia/Karachi";
const rows = [];
const problems = [];

for (const s of sequences) {
  if (!s.to) { problems.push(`${s.ref}: no "**To:**" email address`); continue; }
  const [contact] = must(await db.from("contacts").select("id,company_id,email,do_not_contact,email_status,consent_basis").ilike("email", s.to).order("created_at").limit(1));
  if (!contact) { problems.push(`${s.ref}: ${s.to} is not a contact in the CRM`); continue; }
  if (contact.do_not_contact || ["bounced", "invalid"].includes(contact.email_status) || contact.consent_basis === "unknown") {
    problems.push(`${s.ref}: ${s.to} can't be emailed (do-not-contact, bounced or no consent basis)`); continue;
  }
  const [company] = must(await db.from("companies").select("id,lead_ref,name,owner_id,region,time_zone").eq("id", contact.company_id));
  if (!company.owner_id) { problems.push(`${s.ref}: ${company.name} has no owner (the owner's Gmail sends it)`); continue; }
  const tz = plan.time_zones?.[s.ref] ?? leadTimeZone(company);
  if (plan.time_zones?.[s.ref] && !company.time_zone && !dryRun) {
    must(await db.from("companies").update({ time_zone: tz }).eq("id", company.id));
  }
  const subject1 = s.emails[1]?.subject;
  for (const step of steps) {
    const e = s.emails[step];
    if (!e) { problems.push(`${s.ref}: no Email ${step} in the file`); continue; }
    const d = new Date(`${plan.start[s.ref]}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(plan.offsets_days[String(step)]));
    const when = zonedLocalToIso(`${d.toISOString().slice(0, 10)}T${plan.time ?? "07:45"}`, tz);
    rows.push({
      row: {
        company_id: company.id, contact_id: contact.id, member_id: company.owner_id, step,
        subject: e.subject ?? (subject1 ? `Re: ${subject1}` : `Following up`), body: e.body,
        status: "pending_approval", scheduled_for: when, source: "import",
        idempotency_key: `seq:${sourceName}:${s.ref}:${contact.id}:${step}`,
      },
      show: `${s.ref.padEnd(9)} ${company.name.slice(0, 30).padEnd(30)} ${s.to.padEnd(38)} Email ${step}  ${fmt(when, tz)} their time = ${fmt(when, teamTz)} yours`,
    });
  }
}

for (const r of rows) console.log(r.show);
let saved = 0;
if (!dryRun && rows.length) {
  const res = must(await db.from("outreach_messages").upsert(rows.map((r) => r.row), { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id"));
  saved = res.length;
}
console.log(`\n${rows.length} email(s) planned${dryRun ? "" : `, ${saved} new saved (the rest were already there)`}; all need approval on the lead page.`);
if (problems.length) {
  console.log(`\nskipped:\n${problems.map((p) => `  ${p}`).join("\n")}`);
}
