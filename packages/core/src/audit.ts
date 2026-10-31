import { db, logActivity, must } from "@agencyos/db";
import { web } from "./adapters.js";
import { applyScore } from "./leads.js";
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

/**
 * Audit the given leads, or the next batch of unaudited ones: store each audit,
 * re-score, and return short findings.
 */
export async function auditCompanies({ company_ids, limit, retry_failed }: { company_ids?: string[]; limit: number; retry_failed?: boolean }) {
  let ids = company_ids;
  if (!ids?.length && retry_failed) {
    // Leads whose most recent audit errored (site down, timeout, lost connection).
    const rows = must(await db().from("website_audits").select("company_id,error,fetched_at").order("fetched_at", { ascending: false }).limit(10_000)) as any[];
    const latest = new Map<string, { error: string | null; at: string }>();
    for (const r of rows) if (!latest.has(r.company_id)) latest.set(r.company_id, { error: r.error, at: r.fetched_at });
    // Oldest failures first, so sites that fail again go to the back of the queue.
    ids = [...latest].filter(([, a]) => a.error).sort((a, b) => a[1].at.localeCompare(b[1].at)).map(([id]) => id).slice(0, limit);
    if (!ids.length) return { audited: 0, results: [] };
  }
  let q = db().from("companies").select("*").not("website", "is", null);
  q = ids?.length ? q.in("id", ids) : q.is("last_audited_at", null).neq("status", "disqualified");
  const companies = must(await q.limit(limit)) as any[];

  const results = [];
  for (const c of companies) {
    const audit = await auditWebsite(c.website);
    // A lookup failure can mean the site is gone or that we're offline. Offline must not
    // mark leads as audited, or they'd never be retried (SPEC: failed fetches never lose a lead).
    if (!audit.ok && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|fetch failed/.test(audit.error) && !(await web.isOnline())) {
      throw new Error(`No internet connection: stopped after ${results.length} sites. Nothing else was marked; run again when online.`);
    }
    must(await db().from("website_audits").insert({
      company_id: c.id,
      url: c.website,
      final_url: audit.finalUrl,
      http_status: audit.status,
      signals: audit.ok ? audit.signals : {},
      error: audit.ok ? null : audit.error,
    }));
    must(await db().from("companies").update({ last_audited_at: new Date().toISOString() }).eq("id", c.id));
    const score = await applyScore(c, audit.ok ? audit.signals : null);
    await logActivity(c.id, "audited", { ok: audit.ok, score: score.score });
    results.push({
      id: c.id,
      name: c.name,
      ok: audit.ok,
      error: audit.ok ? undefined : audit.error,
      score: score.score,
      tier: score.tier,
      key_findings: audit.ok
        ? {
            online_booking: audit.signals.has_online_booking,
            chat: audit.signals.has_chat_widget,
            ad_pixels: audit.signals.ad_pixels,
            uses_ghl: audit.signals.uses_ghl,
            emails_on_site: audit.signals.emails_found,
          }
        : undefined,
    });
  }
  return { audited: results.length, results };
}
