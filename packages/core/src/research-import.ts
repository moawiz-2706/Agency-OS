import type { ConsentBasis } from "./config.js";
import { isValidEmailSyntax, parseCsv } from "./csv.js";
import { isOfferKey, type OfferKey } from "./offers.js";
import { reportErrors, researchReportSchema, type ResearchReport } from "./research.js";
import { db, must } from "@agencyos/db";

// Rows researched by an external AI tool (docs/research/RESEARCH_PROMPT.md), in the
// results_TEMPLATE.csv format. planResearchRow() decides everything about one row
// without touching the database, so the rules are unit-tested; the import script
// looks up what exists and applies the plan.

export const RESULT_COLUMNS = [
  "lead_id", "business_name", "status", "website_checked", "owner_name", "owner_name_source_url", "best_email",
  "email_source_url", "email_on_own_site", "no_unsolicited_email_notice", "phone", "google_rating", "google_review_count",
  "reviews_source_url", "has_online_booking", "booking_tool", "has_chat_or_text", "chat_tool", "runs_ads", "ads_evidence_url",
  "uses_ghl", "field_service_software", "website_quality", "copyright_year", "mobile_friendly", "offers_24_7", "service_area",
  "team_size_estimate", "gap_1", "gap_1_evidence_url", "gap_2", "gap_2_evidence_url", "gap_3", "gap_3_evidence_url",
  "recommended_offer", "second_offer", "offer_reason", "email_hook", "discovery_questions", "fit_score", "confidence",
  "research_notes", "researched_at",
] as const;
export type ResultRow = Record<(typeof RESULT_COLUMNS)[number], string>;

/** Columns that become report or company fields; everything else is kept in report.raw. */
const USED = new Set([
  "lead_id", "offer_reason", "gap_1", "gap_1_evidence_url", "gap_2", "gap_2_evidence_url", "gap_3", "gap_3_evidence_url",
  "recommended_offer", "email_hook", "discovery_questions", "confidence", "service_area",
]);

export type CompanyCtx = { id: string; stage: string; country: "US" | "CA" | null };

export type RowContext = {
  company?: CompanyCtx;
  /** Lowercased emails already saved as contacts on this lead. */
  contactEmails: Set<string>;
  /** Lowercased owner names already saved as contacts on this lead. */
  ownerNames: Set<string>;
  /** Latest external_ai report for this lead: re-importing updates it instead of adding another. */
  existingReportId?: string;
  /** The team owner; recorded as who imported the research. */
  ownerMemberId: string | null;
};

export type NewContact = {
  company_id: string; full_name: string | null; role: string | null; email: string | null; source_url: string;
  source: string; consent_basis: ConsentBasis; email_published_publicly: boolean; do_not_contact: boolean;
};

export type RowPlan =
  | { kind: "skip"; lead_id: string; reason: string }
  | { kind: "reject"; lead_id: string; reason: string }
  | {
      kind: "ok";
      lead_id: string;
      action: "insert" | "update";
      report_id?: string;
      report: ResearchReport & { created_by: string | null };
      company: { id: string; patch: Record<string, unknown> };
      contacts: NewContact[];
      note?: string;
      touch: boolean;
      dropped_gaps: string[];
      warnings: string[];
    };

const clean = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t && !/^(unknown|n\/a|none|-)$/i.test(t) ? t : "";
};
const yes = (v: string | undefined) => /^yes\b/i.test((v ?? "").trim());
const no = (v: string | undefined) => /^no\b/i.test((v ?? "").trim());
const isUrl = (v: string) => {
  try { return /^https?:$/.test(new URL(v).protocol); } catch { return false; }
};
const num = (v: string | undefined) => {
  const t = clean(v).replace(/[^0-9.\-]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** recommended_offer / second_offer: a key, `none`/blank (no offer), or anything else (invalid). */
function offerKey(v: string | undefined): { ok: true; key: OfferKey | null } | { ok: false; value: string } {
  const t = (v ?? "").trim().toLowerCase();
  if (!t || t === "none" || t === "unknown") return { ok: true, key: null };
  return isOfferKey(t) ? { ok: true, key: t } : { ok: false, value: t };
}

export function planResearchRow(row: ResultRow, ctx: RowContext, sourceName: string): RowPlan {
  const lead_id = (row.lead_id ?? "").trim();
  if (!lead_id) return { kind: "reject", lead_id: "(blank)", reason: "missing lead_id" };
  if (/^EXAMPLE/i.test(lead_id)) return { kind: "skip", lead_id, reason: "example row" };
  const c = ctx.company;
  if (!c) return { kind: "skip", lead_id, reason: "unknown lead_id (not in AgencyOS)" };

  const status = clean(row.status).toLowerCase() || "active";
  const closed = status === "closed";
  const warnings: string[] = [];

  // Offers: unknown keys reject the row; `none` is fine.
  const first = offerKey(row.recommended_offer);
  if (!first.ok) return { kind: "reject", lead_id, reason: `unknown offer key "${first.value}" in recommended_offer` };
  const second = offerKey(row.second_offer);
  if (!second.ok) return { kind: "reject", lead_id, reason: `unknown offer key "${second.value}" in second_offer` };

  // Gaps: drop any without a real evidence URL; keep the row if one survives (or the business is closed/down).
  const gaps: { gap: string; evidence_url: string }[] = [];
  const dropped: string[] = [];
  for (const i of [1, 2, 3] as const) {
    const gap = clean(row[`gap_${i}`]);
    if (!gap) continue;
    const url = clean(row[`gap_${i}_evidence_url`]).split(/\s+/)[0] ?? "";
    if (isUrl(url)) gaps.push({ gap, evidence_url: url });
    else dropped.push(`gap_${i} (no evidence URL)`);
  }
  if (!gaps.length && !closed && status !== "website_down") {
    return { kind: "reject", lead_id, reason: dropped.length ? "no gap has an evidence URL" : "no gaps found" };
  }

  const confRaw = num(row.confidence);
  const confidence = Math.min(1, Math.max(0, confRaw ?? 0));
  if (confRaw === null) warnings.push("confidence missing, saved as 0");
  else if (confRaw !== confidence) warnings.push(`confidence ${confRaw} clamped to ${confidence}`);

  const raw: Record<string, string> = {};
  for (const k of RESULT_COLUMNS) if (!USED.has(k) && (row[k] ?? "").trim()) raw[k] = row[k].trim();
  raw.import_file = sourceName;

  const parsed = researchReportSchema.safeParse({
    company_id: c.id,
    summary: clean(row.offer_reason) || clean(row.research_notes) || `External AI research (${status})`,
    service_area: clean(row.service_area) || undefined,
    gaps,
    recommended_offer: first.key,
    hook: clean(row.email_hook) || undefined,
    discovery_questions: clean(row.discovery_questions).split(/\s*\|\s*/).filter(Boolean).slice(0, 5),
    confidence,
    source: "external_ai",
    model: "external_ai",
    raw,
  });
  if (!parsed.success) return { kind: "reject", lead_id, reason: reportErrors(parsed.error).join("; ") };

  // ---- the lead ----
  const patch: Record<string, unknown> = {};
  const reviewsUrl = clean(row.reviews_source_url);
  if (isUrl(reviewsUrl)) {
    const rating = num(row.google_rating), count = num(row.google_review_count);
    if (rating !== null && rating >= 0 && rating <= 5) patch.rating = Math.round(rating * 10) / 10;
    if (count !== null && count >= 0) patch.review_count = Math.round(count);
    patch.reviews_source_url = reviewsUrl;
  }
  const fit = num(row.fit_score);
  if (fit !== null) {
    const score = Math.round(Math.min(100, Math.max(0, fit)));
    patch.score = score;
    patch.tier = score >= 70 ? "high" : score >= 50 ? "medium" : "low";
  }
  let note: string | undefined;
  if (closed && c.stage !== "won") {
    patch.stage = "disqualified";
    note = "closed per research";
  } else if (c.stage === "new") {
    patch.stage = "researching";   // forward only: later stages are left alone
  }

  // ---- contacts: only facts published on their own site, never overwriting ----
  const contacts: NewContact[] = [];
  // Some tools list several addresses ("office@x.ca|jeremy@x.ca"): use the first valid one.
  const email = clean(row.best_email).toLowerCase().split(/[|;,\s]+/).find(isValidEmailSyntax) ?? "";
  const emailUrl = clean(row.email_source_url);
  if (email && yes(row.email_on_own_site) && isUrl(emailUrl) && isValidEmailSyntax(email) && !ctx.contactEmails.has(email)) {
    const noSpam = yes(row.no_unsolicited_email_notice);
    const basis: ConsentBasis = c.country === "US"
      ? "can_spam_b2b"
      : c.country === "CA" && no(row.no_unsolicited_email_notice) ? "casl_implied_published" : "unknown";
    contacts.push({
      company_id: c.id, full_name: null, role: null, email, source_url: emailUrl, source: `research:${sourceName}`,
      consent_basis: basis, email_published_publicly: true, do_not_contact: noSpam,
    });
  } else if (email && !ctx.contactEmails.has(email)) {
    warnings.push("email not added (needs email_on_own_site=yes and an email_source_url)");
  }
  const ownerUrl = clean(row.owner_name_source_url);
  const owners = clean(row.owner_name).split(/\s*\|\s*/).map(clean).filter(Boolean);   // "Derek Peacock|Cody Steeves"
  for (const ownerName of isUrl(ownerUrl) ? owners : []) {
    if (ctx.ownerNames.has(ownerName.toLowerCase())) continue;
    contacts.push({
      company_id: c.id, full_name: ownerName, role: "owner", email: null, source_url: ownerUrl, source: `research:${sourceName}`,
      consent_basis: "unknown", email_published_publicly: false, do_not_contact: false,
    });
  }

  return {
    kind: "ok",
    lead_id,
    action: ctx.existingReportId ? "update" : "insert",
    report_id: ctx.existingReportId,
    report: { ...parsed.data, created_by: ctx.ownerMemberId },
    company: { id: c.id, patch },
    contacts,
    note,
    touch: !ctx.existingReportId,   // one research touch per lead, not one per import
    dropped_gaps: dropped,
    warnings,
  };
}

// ---- column alignment ----
// AI tools sometimes drop or add a cell, which shifts every later value into the
// wrong column. A row with the wrong count is only accepted when the slip is
// inside the gap columns: the 28 columns before them and the 9 after them must
// still look right, and the gaps are re-paired with their evidence URLs.

const HEAD = 28;   // lead_id .. team_size_estimate
const TAIL = 9;    // recommended_offer .. researched_at
const STATUSES = new Set(["active", "closed", "website_down", "not_found", "unknown"]);
const QUALITIES = new Set(["good", "dated", "poor", "none", "unknown"]);
const YES_NO = new Set(["yes", "no", "unknown", ""]);
const offerLike = (v: string) => offerKey(v).ok;

export type AlignedRow = { row: ResultRow; repaired: boolean } | { lead_id: string; error: string };

export function alignResultRow(cells: string[], header: string[]): AlignedRow {
  const lead_id = (cells[0] ?? "").trim() || "(blank)";
  const keys = header.map((h) => h.trim().toLowerCase());
  const toRow = (values: string[], names: readonly string[]) =>
    Object.fromEntries(RESULT_COLUMNS.map((c) => [c, values[names.indexOf(c)] ?? ""])) as ResultRow;

  if (cells.length === header.length) return { row: toRow(cells, keys), repaired: false };

  const standard = keys.length === RESULT_COLUMNS.length && keys.every((k, i) => k === RESULT_COLUMNS[i]);
  const n = cells.length;
  const v = (i: number) => (cells[i] ?? "").trim().toLowerCase();
  const tail = cells.slice(n - TAIL).map((s) => s.trim());
  const headOk = STATUSES.has(v(2)) && QUALITIES.has(v(22)) && YES_NO.has(v(24)) && YES_NO.has(v(25));
  const conf = Number(tail[6]);
  const tailOk = n >= HEAD + TAIL && /^\d{4}-\d{2}-\d{2}$/.test(tail[8] ?? "") && tail[6] !== "" && conf >= 0 && conf <= 1
    && /^\d{1,3}$/.test(tail[5] ?? "") && offerLike(tail[0]) && offerLike(tail[1]);
  if (!standard || !headOk || !tailOk) {
    return { lead_id, error: `row has ${n} columns instead of ${header.length} and can't be realigned safely (the AI tool dropped or added a column); research this lead again` };
  }

  // Re-pair the gap cells: each description, followed by its evidence URL when there is one.
  const middle = cells.slice(HEAD, n - TAIL).map((s) => s.trim());
  const gaps: [string, string][] = [];
  for (let i = 0; i < middle.length; i++) {
    const text = middle[i];
    if (!clean(text) || isUrl(text)) continue;
    const next = middle[i + 1] ?? "";
    gaps.push([text, isUrl(next) ? next : ""]);
    if (isUrl(next)) i++;
  }
  if (gaps.length > 3) return { lead_id, error: `row has ${n} columns and ${gaps.length} gap descriptions; can't tell which is which` };

  const fixed = [...cells.slice(0, HEAD)];
  for (let g = 0; g < 3; g++) fixed.push(gaps[g]?.[0] ?? "", gaps[g]?.[1] ?? "");
  fixed.push(...cells.slice(n - TAIL));
  return { row: toRow(fixed, RESULT_COLUMNS), repaired: true };
}

/** Columns from RESULT_COLUMNS missing in a header row. */
export function missingResultColumns(header: string[]) {
  const have = new Set(header.map((h) => h.trim().toLowerCase()));
  return RESULT_COLUMNS.filter((c) => !have.has(c));
}


const chunk = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/**
 * Import a results CSV: plan every row, then (unless dryRun) write reports,
 * lead updates, contacts, notes and one research touch per new lead.
 */
export async function importResearchCsv(text: string, opts: { sourceName: string; dryRun?: boolean }) {
  const table = parseCsv(text);
  if (table.length < 1) throw new Error("The file is empty");
  const [header, ...data] = table;
  const missing = missingResultColumns(header);
  if (missing.length) throw new Error(`Not in the results_TEMPLATE.csv format; missing column(s): ${missing.join(", ")}`);
  const aligned = data.map((cells) => alignResultRow(cells, header));
  const misaligned = aligned.filter((a): a is Extract<AlignedRow, { error: string }> => "error" in a);
  const good = aligned.filter((a): a is Extract<AlignedRow, { row: ResultRow }> => "row" in a);
  const rows = good.map((a) => a.row);
  const repaired = good.filter((a) => a.repaired).map((a) => a.row.lead_id.trim());

  // ---- look up what already exists ----
  const refs = [...new Set(rows.map((r) => r.lead_id.trim()).filter((r) => r && !/^EXAMPLE/i.test(r)))];
  const companies = new Map<string, CompanyCtx & { lead_ref: string }>();
  for (const part of chunk(refs)) {
    for (const c of must(await db().from("companies").select("id,lead_ref,stage,country").in("lead_ref", part)) as any[]) companies.set(c.lead_ref, c);
  }
  const ids = [...companies.values()].map((c) => c.id);
  const contactEmails = new Map<string, Set<string>>(), ownerNames = new Map<string, Set<string>>(), reports = new Map<string, string>();
  for (const part of chunk(ids)) {
    for (const ct of must(await db().from("contacts").select("company_id,email,full_name,role").in("company_id", part)) as any[]) {
      if (ct.email) (contactEmails.get(ct.company_id) ?? contactEmails.set(ct.company_id, new Set()).get(ct.company_id)!).add(ct.email.toLowerCase());
      if (ct.full_name && ct.role === "owner") (ownerNames.get(ct.company_id) ?? ownerNames.set(ct.company_id, new Set()).get(ct.company_id)!).add(ct.full_name.toLowerCase());
    }
    const rs = must(await db().from("research_reports").select("id,company_id,created_at").eq("source", "external_ai").in("company_id", part).order("created_at", { ascending: false })) as any[];
    for (const r of rs) if (!reports.has(r.company_id)) reports.set(r.company_id, r.id);
  }
  const owner = (must(await db().from("team_members").select("id").eq("role", "owner").eq("active", true).order("created_at").limit(1)) as any[])[0];

  // ---- plan (a lead listed twice in one file only counts once) ----
  const seen = new Set<string>();
  const plans: RowPlan[] = misaligned.map((m) => ({ kind: "reject", lead_id: m.lead_id, reason: m.error }) as RowPlan);
  plans.push(...rows.map((r) => {
    const c = companies.get(r.lead_id.trim());
    if (c && seen.has(c.id)) return { kind: "skip", lead_id: r.lead_id.trim(), reason: "listed twice in this file" } as RowPlan;
    if (c) seen.add(c.id);
    return planResearchRow(r, {
      company: c, contactEmails: c ? contactEmails.get(c.id) ?? new Set() : new Set(), ownerNames: c ? ownerNames.get(c.id) ?? new Set() : new Set(),
      existingReportId: c ? reports.get(c.id) : undefined, ownerMemberId: owner?.id ?? null,
    }, opts.sourceName);
  }));

  // ---- apply ----
  if (!opts.dryRun) {
    for (const p of plans) {
      if (p.kind !== "ok") continue;
      const { company_id: _c, ...report } = p.report;
      if (p.action === "update") must(await db().from("research_reports").update(report).eq("id", p.report_id!));
      else must(await db().from("research_reports").insert(p.report));
      // Touch first: its trigger moves new -> researching; a closed business is then disqualified below.
      if (p.touch) {
        must(await db().from("touches").insert({
          company_id: p.company.id, member_id: owner?.id ?? null, channel: "research", outcome: "done",
          direction: "internal", minutes: 0, summary: "External AI research",
        }));
      }
      if (Object.keys(p.company.patch).length) must(await db().from("companies").update(p.company.patch).eq("id", p.company.id));
      if (p.contacts.length) must(await db().from("contacts").insert(p.contacts));
      if (p.note) must(await db().from("notes").insert({ company_id: p.company.id, member_id: owner?.id ?? null, body: p.note }));
    }
  }

  const ok = plans.filter((p): p is Extract<RowPlan, { kind: "ok" }> => p.kind === "ok");
  return {
    file: opts.sourceName,
    dry_run: !!opts.dryRun,
    rows: data.length,
    repaired: repaired.length,
    imported: ok.filter((p) => p.action === "insert").length,
    updated: ok.filter((p) => p.action === "update").length,
    skipped: plans.filter((p) => p.kind === "skip") as Extract<RowPlan, { kind: "skip" }>[],
    rejected: plans.filter((p) => p.kind === "reject") as Extract<RowPlan, { kind: "reject" }>[],
    contacts_added: ok.reduce((n, p) => n + p.contacts.length, 0),
    do_not_contact: ok.reduce((n, p) => n + p.contacts.filter((c) => c.do_not_contact).length, 0),
    disqualified: ok.filter((p) => p.note).map((p) => p.lead_id),
    notes: ok.flatMap((p) => [...p.dropped_gaps.map((d) => `${p.lead_id}: dropped ${d}`), ...p.warnings.map((w) => `${p.lead_id}: ${w}`)]),
  };
}
