#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NICHES, STARTER_CITIES } from "./config.js";
import { db, logActivity, must } from "./db.js";
import { searchPlaces } from "./places.js";
import { auditWebsite, type WebsiteSignals } from "./audit.js";
import { scoreLead, statusForScore } from "./scoring.js";

// IMPORTANT: stdio transport uses stdout for protocol messages.
// Log only with console.error.

const server = new McpServer({ name: "agencyos", version: "0.1.0" });

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] });

// Statuses the auto-scorer may change. Anything further along is yours.
const AUTO_STATUSES = ["new", "review", "qualified"];

const STATUSES = [
  "new", "qualified", "review", "ready_for_outreach", "contacted", "replied",
  "interested", "meeting_booked", "proposal_sent", "won", "lost", "disqualified",
] as const;

// Columns returned in lists — kept small so Claude uses less of your Pro limit.
const LIST_COLS = "id,name,niche,city,region,country,phone,website,rating,review_count,status,score,tier";

async function applyScore(company: any, signals: WebsiteSignals | null) {
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

// ---------------------------------------------------------------
server.registerTool(
  "list_niches_and_markets",
  {
    title: "List niches and starter markets",
    description: "Show the niche presets and starter US/Canada cities AgencyOS is set up for.",
    inputSchema: {},
  },
  async () => ok({ niches: NICHES, starter_cities: STARTER_CITIES }),
);

// ---------------------------------------------------------------
server.registerTool(
  "find_leads",
  {
    title: "Find and save leads",
    description:
      "Search Google Places for businesses in a niche + city, save new ones to Supabase (deduped by Google place ID), " +
      "and give each a first score. Returns counts and the new leads only. Each call costs Google API credit.",
    inputSchema: {
      niche: z.string().describe(`Preset key (${Object.keys(NICHES).join(", ")}) or any free-text business type`),
      city: z.string().describe('e.g. "Dallas, TX" or "Toronto, ON"'),
      country: z.enum(["US", "CA"]),
      max_results: z.number().int().min(1).max(60).default(20),
    },
  },
  async ({ niche, city, country, max_results }) => {
    try {
      const preset = NICHES[niche];
      const queries = preset ? preset.queries : [niche];
      const perQuery = Math.ceil(max_results / queries.length);

      const seen = new Map<string, Awaited<ReturnType<typeof searchPlaces>>[number]>();
      for (const q of queries) {
        const places = await searchPlaces({ query: `${q} in ${city}`, regionCode: country, maxResults: perQuery });
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
            fresh.map((p) => ({ ...p, niche, source: "google_places", first_search_run_id: run.id, google_data_fetched_at: now })),
          ).select("*"),
        ) as any[];
        for (const c of inserted) {
          await applyScore(c, null);
          await logActivity(c.id, "discovered", { search_run_id: run.id });
        }
      }

      return ok({
        search_run_id: run.id,
        found: places.length,
        already_in_db: places.length - fresh.length,
        saved_new: inserted.length,
        next_step: "Run audit_websites to check their sites and refine scores.",
        new_leads: inserted.map((c) => ({ id: c.id, name: c.name, city: c.city, website: c.website, reviews: c.review_count, rating: c.rating })),
      });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------
server.registerTool(
  "audit_websites",
  {
    title: "Audit lead websites",
    description:
      "Fetch the homepage of leads not yet audited, detect booking/chat/ad-pixel/GHL signals and published emails, " +
      "store the audit and re-score. Pass company_ids for specific leads, or leave empty to process the next batch.",
    inputSchema: {
      company_ids: z.array(z.string().uuid()).optional(),
      limit: z.number().int().min(1).max(25).default(10),
    },
  },
  async ({ company_ids, limit }) => {
    try {
      let q = db().from("companies").select("*").not("website", "is", null);
      q = company_ids?.length ? q.in("id", company_ids) : q.is("last_audited_at", null).neq("status", "disqualified");
      const companies = must(await q.limit(limit)) as any[];

      const results = [];
      for (const c of companies) {
        const audit = await auditWebsite(c.website);
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
      return ok({ audited: results.length, results });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------
server.registerTool(
  "list_leads",
  {
    title: "List leads",
    description: "List saved leads with filters, highest score first.",
    inputSchema: {
      status: z.enum(STATUSES).optional(),
      tier: z.enum(["high", "medium", "low"]).optional(),
      niche: z.string().optional(),
      city: z.string().optional().describe("Partial match, e.g. Dallas"),
      country: z.enum(["US", "CA"]).optional(),
      min_score: z.number().int().min(0).max(100).optional(),
      unaudited_only: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
  },
  async (f) => {
    try {
      let q = db().from("companies").select(LIST_COLS).order("score", { ascending: false, nullsFirst: false });
      if (f.status) q = q.eq("status", f.status);
      if (f.tier) q = q.eq("tier", f.tier);
      if (f.niche) q = q.eq("niche", f.niche);
      if (f.city) q = q.ilike("city", `%${f.city}%`);
      if (f.country) q = q.eq("country", f.country);
      if (f.min_score != null) q = q.gte("score", f.min_score);
      if (f.unaudited_only) q = q.is("last_audited_at", null);
      return ok(must(await q.limit(f.limit)));
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------
server.registerTool(
  "get_lead",
  {
    title: "Get lead details",
    description: "Full record for one lead: company, score reasons, latest website audit, contacts and recent activity.",
    inputSchema: { company_id: z.string().uuid() },
  },
  async ({ company_id }) => {
    try {
      const company = must(await db().from("companies").select("*").eq("id", company_id).single());
      const audit = must(await db().from("website_audits").select("*").eq("company_id", company_id).order("fetched_at", { ascending: false }).limit(1));
      const contacts = must(await db().from("contacts").select("*").eq("company_id", company_id));
      const activity = must(await db().from("activities").select("type,payload,created_at").eq("company_id", company_id).order("created_at", { ascending: false }).limit(15));
      return ok({ company, latest_audit: (audit as any[])[0] ?? null, contacts, activity });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------
server.registerTool(
  "update_lead",
  {
    title: "Update lead",
    description: "Change a lead's pipeline status and/or add a note. Every change is logged.",
    inputSchema: {
      company_id: z.string().uuid(),
      status: z.enum(STATUSES).optional(),
      note: z.string().max(2000).optional(),
    },
  },
  async ({ company_id, status, note }) => {
    try {
      const current = must(await db().from("companies").select("status,notes").eq("id", company_id).single()) as any;
      const update: Record<string, unknown> = {};
      if (status) update.status = status;
      if (note) update.notes = [current.notes, `[${new Date().toISOString().slice(0, 10)}] ${note}`].filter(Boolean).join("\n");
      if (!Object.keys(update).length) return ok({ unchanged: true });
      must(await db().from("companies").update(update).eq("id", company_id));
      if (status && status !== current.status) await logActivity(company_id, "status_changed", { from: current.status, to: status });
      if (note) await logActivity(company_id, "note", { note });
      return ok({ updated: true, ...update });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------
server.registerTool(
  "add_contact",
  {
    title: "Add contact",
    description:
      "Save a person/email for a lead. Always record where it was found (source_url). For Canadian leads, only use " +
      "casl_implied_published if the email is openly published on their site with no 'no unsolicited email' notice.",
    inputSchema: {
      company_id: z.string().uuid(),
      full_name: z.string().optional(),
      role: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      source_url: z.string().url(),
      email_published_publicly: z.boolean().default(false),
      consent_basis: z.enum(["unknown", "can_spam_b2b", "casl_implied_published", "casl_implied_relationship", "express"]).default("unknown"),
    },
  },
  async (c) => {
    try {
      if (c.email) {
        c.email = c.email.toLowerCase();
        const domain = c.email.split("@")[1];
        const sup = must(await db().from("suppressions").select("id").or(`email.eq."${c.email}",domain.eq."${domain}"`).limit(1)) as any[];
        if (sup.length) return ok({ saved: false, reason: "Email or domain is on the suppression list" });
      }
      const row = must(await db().from("contacts").insert(c).select("id").single()) as { id: string };
      await logActivity(c.company_id, "contact_added", { contact_id: row.id, source_url: c.source_url });
      return ok({ saved: true, contact_id: row.id });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------
server.registerTool(
  "suppress",
  {
    title: "Suppress email or domain",
    description: "Add an email or domain to the never-contact list (unsubscribe, bounce, asked not to contact).",
    inputSchema: {
      email: z.string().email().optional(),
      domain: z.string().optional(),
      reason: z.string(),
    },
  },
  async ({ email, domain, reason }) => {
    try {
      if (!email && !domain) throw new Error("Give an email or a domain");
      email = email?.toLowerCase();
      domain = domain?.toLowerCase().replace(/^www\./, "");
      must(await db().from("suppressions").insert({ email, domain, reason }));
      if (email) must(await db().from("contacts").update({ do_not_contact: true }).eq("email", email));
      return ok({ suppressed: email ?? domain });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------
server.registerTool(
  "pipeline_summary",
  {
    title: "Pipeline summary",
    description: "Lead counts and average score per pipeline status, plus the last 5 searches.",
    inputSchema: {},
  },
  async () => {
    try {
      const pipeline = must(await db().from("pipeline_summary").select("*"));
      const runs = must(await db().from("search_runs").select("niche,city,country,results_count,new_count,created_at").order("created_at", { ascending: false }).limit(5));
      return ok({ pipeline, recent_searches: runs });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("AgencyOS MCP server running (stdio)");
