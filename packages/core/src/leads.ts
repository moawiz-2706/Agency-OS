import type { Place } from "@agencyos/adapters";
import { db, logActivity, must } from "@agencyos/db";
import { leadSource } from "./adapters.js";
import { AUTO_STATUSES, NICHES, type LeadStatus } from "./config.js";
import { scoreLead, statusForScore } from "./scoring.js";
import type { WebsiteSignals } from "./signals.js";

// Columns returned in lists — kept small so Claude uses less of your Pro limit.
const LIST_COLS = "id,name,niche,city,region,country,phone,website,rating,review_count,status,score,tier";

export async function applyScore(company: any, signals: WebsiteSignals | null) {
  const result = scoreLead({ ...company, signals });
  const update: Record<string, unknown> = {
    score: result.score,
    tier: result.tier,
    score_breakdown: { reasons: result.reasons, scored_with_audit: !!signals },
  };
  if (AUTO_STATUSES.includes(company.status)) update.status = statusForScore(result);
  must(await db().from("companies").update(update).eq("id", company.id));
  return result;
}

/** Search a niche + city, save new businesses (deduped by place ID) and give each a first score. */
export async function findLeads({ niche, city, country, max_results }: {
  niche: string;
  city: string;
  country: "US" | "CA";
  max_results: number;
}) {
  const source = leadSource();
  const preset = NICHES[niche];
  const queries = preset ? preset.queries : [niche];
  const perQuery = Math.ceil(max_results / queries.length);

  const seen = new Map<string, Place>();
  for (const q of queries) {
    const places = await source.search({ query: `${q} in ${city}`, regionCode: country, maxResults: perQuery });
    for (const p of places) seen.set(p.google_place_id, p);
    if (seen.size >= max_results) break;
  }
  const places = [...seen.values()].slice(0, max_results);

  const ids = places.map((p) => p.google_place_id);
  const existing = ids.length
    ? must(await db().from("companies").select("google_place_id").in("google_place_id", ids))
    : [];
  const existingIds = new Set((existing as { google_place_id: string }[]).map((r) => r.google_place_id));
  const fresh = places.filter((p) => !existingIds.has(p.google_place_id) && (p.country === country || !p.country));

  const run = must(
    await db().from("search_runs").insert({
      niche, query: queries.join(" | "), city, country,
      results_count: places.length, new_count: fresh.length,
    }).select("id").single(),
  ) as { id: string };

  let inserted: any[] = [];
  if (fresh.length) {
    const now = new Date().toISOString();
    inserted = must(
      await db().from("companies").insert(
        fresh.map((p) => ({ ...p, niche, source: source.name, first_search_run_id: run.id, google_data_fetched_at: now })),
      ).select("*"),
    ) as any[];
    for (const c of inserted) {
      await applyScore(c, null);
      await logActivity(c.id, "discovered", { search_run_id: run.id });
    }
  }

  return {
    search_run_id: run.id,
    found: places.length,
    already_in_db: places.length - fresh.length,
    saved_new: inserted.length,
    next_step: "Run audit_websites to check their sites and refine scores.",
    new_leads: inserted.map((c) => ({ id: c.id, name: c.name, city: c.city, website: c.website, reviews: c.review_count, rating: c.rating })),
  };
}

export type LeadFilter = {
  status?: LeadStatus;
  tier?: "high" | "medium" | "low";
  niche?: string;
  city?: string;
  country?: "US" | "CA";
  min_score?: number;
  unaudited_only?: boolean;
  limit: number;
};

export async function listLeads(f: LeadFilter) {
  let q = db().from("companies").select(LIST_COLS).order("score", { ascending: false, nullsFirst: false });
  if (f.status) q = q.eq("status", f.status);
  if (f.tier) q = q.eq("tier", f.tier);
  if (f.niche) q = q.eq("niche", f.niche);
  if (f.city) q = q.ilike("city", `%${f.city}%`);
  if (f.country) q = q.eq("country", f.country);
  if (f.min_score != null) q = q.gte("score", f.min_score);
  if (f.unaudited_only) q = q.is("last_audited_at", null);
  return must(await q.limit(f.limit));
}

export async function getLead(company_id: string) {
  const company = must(await db().from("companies").select("*").eq("id", company_id).single());
  const audit = must(await db().from("website_audits").select("*").eq("company_id", company_id).order("fetched_at", { ascending: false }).limit(1));
  const contacts = must(await db().from("contacts").select("*").eq("company_id", company_id));
  const activity = must(await db().from("activities").select("type,payload,created_at").eq("company_id", company_id).order("created_at", { ascending: false }).limit(15));
  return { company, latest_audit: (audit as any[])[0] ?? null, contacts, activity };
}

/** Change a lead's status and/or append a dated note. Both are logged. */
export async function updateLead({ company_id, status, note }: { company_id: string; status?: LeadStatus; note?: string }) {
  const current = must(await db().from("companies").select("status,notes").eq("id", company_id).single()) as any;
  const update: Record<string, unknown> = {};
  if (status) update.status = status;
  if (note) update.notes = [current.notes, `[${new Date().toISOString().slice(0, 10)}] ${note}`].filter(Boolean).join("\n");
  if (!Object.keys(update).length) return { unchanged: true };
  must(await db().from("companies").update(update).eq("id", company_id));
  if (status && status !== current.status) await logActivity(company_id, "status_changed", { from: current.status, to: status });
  if (note) await logActivity(company_id, "note", { note });
  return { updated: true, ...update };
}
