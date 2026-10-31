import { db, logActivity, must, selectAll } from "@agencyos/db";
import { web } from "./adapters.js";
import { applyScore } from "./leads.js";
import { recommendOffers, type Offer } from "./offers.js";
import { runPool } from "./pool.js";
import { detectSignals } from "./signals.js";

export async function auditWebsite(url: string) {
  if (!(await web.robotsAllows(url))) {
    return { ok: false as const, error: "robots.txt disallows crawling", status: null, finalUrl: url };
  }
  try {
    const r = await web.fetch(url);
    if (r.status >= 400) return { ok: false as const, error: `HTTP ${r.status}`, status: r.status, finalUrl: r.finalUrl };
    return { ok: true as const, status: r.status, finalUrl: r.finalUrl, signals: detectSignals(r.text, r.finalUrl) };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message, status: null, finalUrl: url };
  }
}

/** This machine lost its connection; nothing was recorded for the lead being checked. */
export class OfflineError extends Error {
  constructor() { super("No internet connection"); this.name = "OfflineError"; }
}

/** How many ranked offers we keep on the lead. */
const TOP_OFFERS = 3;

export type AuditOutcome = {
  id: string; name: string; ok: boolean; error?: string; offers: Offer[];
  score: number; tier: string; prev_tier: string | null;
  key_findings?: { online_booking: boolean; chat: boolean; ad_pixels: string[]; uses_ghl: boolean; emails_on_site: string[] };
};

/** Fetch one lead's site, store the audit, re-score it. Throws OfflineError instead of recording a false failure. */
export async function auditCompany(c: any): Promise<AuditOutcome> {
  const audit = await auditWebsite(c.website);
  // A lookup failure can mean the site is gone or that we're offline. Offline must not
  // mark leads as audited, or they'd never be retried (SPEC: failed fetches never lose a lead).
  if (!audit.ok && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|fetch failed/.test(audit.error) && !(await web.isOnline())) {
    throw new OfflineError();
  }
  must(await db().from("website_audits").insert({
    company_id: c.id,
    url: c.website,
    final_url: audit.finalUrl,
    http_status: audit.status,
    signals: audit.ok ? audit.signals : {},
    error: audit.ok ? null : audit.error,
  }));
  const offers = recommendOffers({ ...c, signals: audit.ok ? audit.signals : null }).slice(0, TOP_OFFERS);
  must(await db().from("companies").update({ last_audited_at: new Date().toISOString(), recommended_offers: offers }).eq("id", c.id));
  const score = await applyScore(c, audit.ok ? audit.signals : null);
  await logActivity(c.id, "audited", { ok: audit.ok, score: score.score, offers: offers.map((o) => o.key) });
  return {
    id: c.id,
    name: c.name,
    ok: audit.ok,
    error: audit.ok ? undefined : audit.error,
    score: score.score,
    tier: score.tier,
    prev_tier: c.tier ?? null,
    offers,
    key_findings: audit.ok
      ? {
          online_booking: audit.signals.has_online_booking,
          chat: audit.signals.has_chat_widget,
          ad_pixels: audit.signals.ad_pixels,
          uses_ghl: audit.signals.uses_ghl,
          emails_on_site: audit.signals.emails_found,
        }
      : undefined,
  };
}

/** Leads whose most recent audit errored (site down, timeout, lost connection), oldest failure first. */
async function failedAuditIds() {
  const rows = await selectAll<{ company_id: string; error: string | null; fetched_at: string }>((from, to) =>
    db().from("website_audits").select("company_id,error,fetched_at").order("fetched_at", { ascending: false }).range(from, to));
  const latest = new Map<string, { error: string | null; at: string }>();
  for (const r of rows) if (!latest.has(r.company_id)) latest.set(r.company_id, { error: r.error, at: r.fetched_at });
  // Oldest failures first, so sites that fail again go to the back of the queue.
  return [...latest].filter(([, a]) => a.error).sort((a, b) => a[1].at.localeCompare(b[1].at)).map(([id]) => id);
}

/** The leads an audit run should check: never audited, or (retry_failed) last audit failed. */
export async function auditCandidates({ limit, retry_failed, company_ids }: { limit?: number; retry_failed?: boolean; company_ids?: string[] }) {
  let ids = company_ids?.length ? company_ids : undefined;
  if (!ids && retry_failed) {
    ids = await failedAuditIds();
    if (limit) ids = ids.slice(0, limit);
    if (!ids.length) return [];
  }
  const rows: any[] = [];
  if (ids) {
    for (let i = 0; i < ids.length; i += 200) {
      rows.push(...(must(await db().from("companies").select("*").not("website", "is", null).in("id", ids.slice(i, i + 200))) as any[]));
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  } else {
    rows.push(...await selectAll<any>((from, to) =>
      db().from("companies").select("*").not("website", "is", null).is("last_audited_at", null).neq("status", "disqualified")
        .order("score", { ascending: false, nullsFirst: false }).order("id").range(from, to)));
  }
  return limit ? rows.slice(0, limit) : rows;
}

/** MCP tool: audit specific leads or the next small batch, one at a time. */
export async function auditCompanies({ company_ids, limit, retry_failed }: { company_ids?: string[]; limit: number; retry_failed?: boolean }) {
  const companies = await auditCandidates({ company_ids, limit, retry_failed });
  const results: AuditOutcome[] = [];
  for (const c of companies) {
    try {
      results.push(await auditCompany(c));
    } catch (e) {
      if (e instanceof OfflineError) {
        throw new Error(`No internet connection: stopped after ${results.length} sites. Nothing else was marked; run again when online.`);
      }
      throw e;
    }
  }
  return { audited: results.length, results };
}

/** Bulk run for the CLI: many leads, `concurrency` at a time, reporting each as it finishes. */
export async function auditBatch(opts: {
  limit?: number; retry_failed?: boolean; concurrency?: number;
  onStart?: (total: number) => void;
  onResult?: (r: AuditOutcome, done: number, total: number) => void;
}) {
  const companies = await auditCandidates({ limit: opts.limit, retry_failed: opts.retry_failed });
  opts.onStart?.(companies.length);
  let done = 0;
  const run = await runPool(companies, opts.concurrency ?? 6, async (c) => {
    const r = await auditCompany(c);
    opts.onResult?.(r, ++done, companies.length);
    return r;
  });
  const results = run.results.filter((r): r is AuditOutcome => !!r);
  return {
    total: companies.length,
    results,
    stopped_offline: run.error instanceof OfflineError,
    error: run.error && !(run.error instanceof OfflineError) ? (run.error as Error).message : undefined,
  };
}

/** Group failure messages into a few readable reasons for a summary. */
export function failureReason(error: string) {
  if (/robots\.txt/i.test(error)) return "blocked by robots.txt";
  if (/ENOTFOUND|EAI_AGAIN|ESERVFAIL|getaddrinfo/i.test(error)) return "domain not found";
  if (/timeout|aborted|ETIMEDOUT/i.test(error)) return "timed out";
  if (/^HTTP (\d)/.test(error)) return `HTTP ${error.match(/^HTTP (\d)/)![1]}xx`;
  if (/private address|port|only http/i.test(error)) return "blocked (unsafe address)";
  if (/redirect/i.test(error)) return "too many redirects";
  if (/cert|SSL|TLS/i.test(error)) return "SSL error";
  return "other";
}
