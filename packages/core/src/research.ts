import { z } from "zod";
import { db, logActivity, must, selectAll } from "@agencyos/db";
import { OFFERS, OFFER_KEYS, type OfferKey } from "./offers.js";

// Research reports (SPEC module 4). The same schema validates Claude's reports via
// MCP and rows imported from external AI research, so both obey the same rules:
// every gap needs evidence, offers use the seven keys, confidence is 0-1.

export const gapSchema = z.object({
  gap: z.string().trim().min(1, "a gap needs a description").max(300),
  evidence_url: z.string({ required_error: "every gap needs an evidence_url" }).trim().url("evidence_url must be a full URL (https://...)"),
  detail: z.string().max(500).optional(),
});

export const researchReportSchema = z.object({
  company_id: z.string().uuid(),
  summary: z.string().trim().min(1).max(2000),
  services: z.array(z.string().max(100)).max(30).default([]),
  service_area: z.string().max(300).optional(),
  observed: z.array(z.object({ fact: z.string().max(300), evidence_url: z.string().url().optional() })).max(20).default([]),
  inferred: z.array(z.string().max(300)).max(20).default([]),
  unknown: z.array(z.string().max(300)).max(20).default([]),
  gaps: z.array(gapSchema).max(5),
  recommended_offer: z.enum(OFFER_KEYS as [OfferKey, ...OfferKey[]]).nullable().default(null),
  hook: z.string().max(300).optional(),
  discovery_questions: z.array(z.string().max(300)).max(5).default([]),
  confidence: z.number().min(0).max(1),
  source: z.enum(["claude", "external_ai", "manual"]).default("claude"),
  model: z.string().max(100).optional(),
  raw: z.record(z.unknown()).default({}),
});
export type ResearchReport = z.infer<typeof researchReportSchema>;

/** Plain-English reasons a report was rejected, e.g. "gaps.1.evidence_url: every gap needs an evidence_url". */
export function reportErrors(e: z.ZodError) {
  return e.issues.map((i) => `${i.path.join(".") || "report"}: ${i.message}`);
}

/** Stages a new report may lift a lead out of (never moves it backwards). */
const BEFORE_RESEARCH = ["new"];

/** Validate and store a report, then move the lead from new -> researching. */
export async function saveResearchReport(input: unknown, opts: { created_by?: string | null } = {}) {
  const parsed = researchReportSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Report rejected:\n- ${reportErrors(parsed.error).join("\n- ")}`);
  const r = parsed.data;
  const company = must(await db().from("companies").select("id,name,stage").eq("id", r.company_id).maybeSingle()) as { id: string; name: string; stage: string } | null;
  if (!company) throw new Error(`No lead with id ${r.company_id}`);

  const row = must(await db().from("research_reports").insert({ ...r, created_by: opts.created_by ?? null }).select("id").single()) as { id: string };
  if (BEFORE_RESEARCH.includes(company.stage)) {
    must(await db().from("companies").update({ stage: "researching" }).eq("id", r.company_id));
  }
  await logActivity(r.company_id, "research_saved", { report_id: row.id, source: r.source, offer: r.recommended_offer, gaps: r.gaps.length });
  return { saved: true, report_id: row.id, lead: company.name, gaps: r.gaps.length, recommended_offer: r.recommended_offer };
}

/** Everything Claude needs to research one lead, compactly: no raw HTML. */
export async function getResearchInput(companyId: string) {
  const [company, audit, contacts, report] = await Promise.all([
    db().from("companies").select("id,name,trade,niche,city,region,country,website,phone,email,rating,review_count,score,tier,stage,recommended_offers,score_breakdown,facebook,instagram").eq("id", companyId).maybeSingle(),
    db().from("website_audits").select("final_url,http_status,signals,error,fetched_at").eq("company_id", companyId).order("fetched_at", { ascending: false }).limit(1),
    db().from("contacts").select("full_name,role,email,phone,consent_basis,source_url").eq("company_id", companyId),
    db().from("research_reports").select("id,source,summary,recommended_offer,created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(1),
  ]);
  const c = must(company) as Record<string, any> | null;
  if (!c) throw new Error(`No lead with id ${companyId}`);
  const a = (must(audit) as any[])[0];
  const s = a?.signals ?? {};
  return {
    lead: {
      id: c.id, name: c.name, trade: c.trade ?? c.niche, location: [c.city, c.region, c.country].filter(Boolean).join(", "),
      website: c.website, phone: c.phone, email: c.email, google: { rating: c.rating, reviews: c.review_count },
      socials: { facebook: c.facebook, instagram: c.instagram }, score: c.score, tier: c.tier, stage: c.stage,
      score_reasons: (c.score_breakdown?.reasons ?? []).map((r: { reason: string }) => r.reason),
    },
    audit: a
      ? a.error
        ? { ok: false, error: a.error, checked_at: a.fetched_at }
        : {
            ok: true, url: a.final_url, checked_at: a.fetched_at,
            signals: {
              online_booking: s.has_online_booking, booking_tools: s.booking_tools, chat: s.has_chat_widget, chat_tools: s.chat_tools,
              text_us: s.has_sms_cta, review_widget: s.has_review_widget, ad_pixels: s.ad_pixels, uses_ghl: s.uses_ghl,
              mobile_friendly: s.mobile_viewport, https: s.https, copyright_year: s.copyright_year ?? null, emails_on_site: s.emails_found,
            },
          }
      : null,
    recommended_offers: c.recommended_offers ?? [],
    contacts: must(contacts) ?? [],
    latest_report: (must(report) as any[])[0] ?? null,
    offer_catalogue: Object.fromEntries(Object.entries(OFFERS).map(([k, v]) => [k, v.title])),
    instructions: "Visit the website and listing yourself. Separate observed (seen, with URL) from inferred. Every gap needs an evidence_url. Pick recommended_offer from offer_catalogue keys.",
  };
}

/** Audited leads with no research report yet, highest score first. */
export async function listResearchQueue({ limit }: { limit: number }) {
  const reported = new Set((await selectAll<{ company_id: string }>((from, to) =>
    db().from("research_reports").select("company_id").order("id").range(from, to))).map((r) => r.company_id));
  const out: any[] = [];
  for (let from = 0; out.length < limit; from += 200) {
    const page = must(await db().from("companies")
      .select("id,name,trade,city,region,country,website,score,tier,stage,recommended_offers")
      .not("last_audited_at", "is", null)
      .not("stage", "in", "(won,lost,disqualified)")
      .order("score", { ascending: false, nullsFirst: false }).order("id")
      .range(from, from + 199)) as any[];
    for (const c of page) if (!reported.has(c.id) && out.length < limit) out.push(c);
    if (page.length < 200) break;
  }
  return {
    queue: out.map((c) => ({
      id: c.id, name: c.name, trade: c.trade, location: [c.city, c.region, c.country].filter(Boolean).join(", "),
      website: c.website, score: c.score, tier: c.tier, stage: c.stage,
      top_offer: c.recommended_offers?.[0]?.key ?? null,
    })),
    next_step: "Call get_research_input for one lead, research it, then save_research_report.",
  };
}
