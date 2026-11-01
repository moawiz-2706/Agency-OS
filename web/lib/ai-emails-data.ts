import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leadTimeZone } from "@/lib/tz";
import { OFFER_TITLE, isOfferKey } from "@/lib/offers";
import type { ImportLead } from "@/lib/ai-emails";

// Researched leads for the AI email workflow, read as the signed-in user (RLS).
// "Emailable" mirrors outreach_block_reason (migration 0006); queue_email checks it
// again when the drafts are saved, so this only decides what's offered.

type Contact = { id: string; company_id: string; full_name: string | null; role: string | null; email: string | null;
  do_not_contact: boolean; email_status: string | null; consent_basis: string; email_is_role: boolean | null; created_at: string };
type Company = { id: string; name: string; lead_ref: string | null; trade: string | null; niche: string | null; city: string | null; region: string | null;
  country: string | null; website: string | null; score: number | null; stage: string; time_zone: string | null; enrichment: Record<string, string> | null;
  recommended_offers: { key: string }[] | null };
type Report = { company_id: string; summary: string; gaps: { gap: string; evidence_url?: string; detail?: string }[]; hook: string | null;
  recommended_offer: string | null; discovery_questions: string[] | null; updated_at: string };

const CASL_OK = ["casl_implied_published", "casl_implied_relationship", "express"];
const CLOSED = ["won", "lost", "disqualified"];

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export type ResearchedLead = { company: Company; report: Report; contact: Contact; contacts: Contact[]; emailed: boolean; waiting: boolean };

/** Open leads with a research report and at least one contact we may email. */
export async function researchedLeads(supabase: SupabaseClient): Promise<ResearchedLead[]> {
  const reports = await all<Report>((a, b) => supabase.from("research_reports")
    .select("company_id,summary,gaps,hook,recommended_offer,discovery_questions,updated_at").order("updated_at", { ascending: false }).range(a, b));
  const latest = new Map<string, Report>();
  for (const r of reports) if (!latest.has(r.company_id)) latest.set(r.company_id, r);
  const ids = [...latest.keys()];
  if (!ids.length) return [];

  const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
  const [companies, contacts, msgs, sup] = await Promise.all([
    Promise.all(chunks.map((c) => supabase.from("companies")
      .select("id,name,lead_ref,trade,niche,city,region,country,website,score,stage,time_zone,enrichment,recommended_offers").in("id", c))).then((r) => r.flatMap((x) => (x.data ?? []) as Company[])),
    Promise.all(chunks.map((c) => supabase.from("contacts")
      .select("id,company_id,full_name,role,email,do_not_contact,email_status,consent_basis,email_is_role,created_at").in("company_id", c))).then((r) => r.flatMap((x) => (x.data ?? []) as Contact[])),
    Promise.all(chunks.map((c) => supabase.from("outreach_messages").select("company_id,status").in("company_id", c)
      .in("status", ["pending_approval", "approved", "queued", "sent"]).limit(5000))).then((r) => r.flatMap((x) => (x.data ?? []) as { company_id: string; status: string }[])),
    all<{ email: string | null; domain: string | null }>((a, b) => supabase.from("suppressions").select("email,domain").range(a, b)),
  ]);
  const blockedEmail = new Set(sup.map((s) => s.email?.toLowerCase()).filter(Boolean));
  const blockedDomain = new Set(sup.map((s) => s.domain?.toLowerCase()).filter(Boolean));

  const out: ResearchedLead[] = [];
  for (const co of companies) {
    if (CLOSED.includes(co.stage)) continue;
    const ok = contacts.filter((c) => c.company_id === co.id && c.email && !c.do_not_contact
      && !["bounced", "invalid"].includes(c.email_status ?? "") && c.consent_basis !== "unknown"
      && (co.country !== "CA" || CASL_OK.includes(c.consent_basis))
      && !blockedEmail.has(c.email.toLowerCase()) && !blockedDomain.has(c.email.split("@")[1].toLowerCase()))
      .sort((a, b) => Number(!!a.email_is_role) - Number(!!b.email_is_role) || Number(!a.full_name) - Number(!b.full_name) || a.created_at.localeCompare(b.created_at));
    if (!ok.length) continue;
    const mine = msgs.filter((m) => m.company_id === co.id);
    out.push({
      company: co, report: latest.get(co.id)!, contact: ok[0], contacts: ok,
      emailed: mine.some((m) => m.status === "sent"), waiting: mine.some((m) => m.status !== "sent"),
    });
  }
  return out.sort((a, b) => (b.company.score ?? 0) - (a.company.score ?? 0));
}

const offerName = (k: string | null) => (k && isOfferKey(k) ? `${k} (${OFFER_TITLE[k]})` : k ?? "");

/** One row of researched-leads.csv. */
export function exportRow(l: ResearchedLead) {
  const e = l.company.enrichment ?? {};
  return {
    lead_id: l.company.id, company: l.company.name, trade: l.company.trade ?? l.company.niche ?? "", city: l.company.city ?? "",
    state: l.company.region ?? "", country: l.company.country ?? "", website: l.company.website ?? "",
    google_rating: e.rating ?? e.google_rating ?? "", google_reviews: e.reviews ?? e.review_count ?? e.google_reviews ?? "",
    contact_name: l.contact.full_name ?? "", contact_role: l.contact.role ?? "", contact_email: l.contact.email ?? "",
    score: l.company.score ?? "", research_summary: l.report.summary,
    issues_found: (l.report.gaps ?? []).map((g, i) => `${i + 1}. ${g.gap}${g.detail ? `: ${g.detail}` : ""}${g.evidence_url ? ` (evidence: ${g.evidence_url})` : ""}`).join("\n"),
    personal_hook: l.report.hook ?? "", recommended_offer: offerName(l.report.recommended_offer),
    other_offers: (l.company.recommended_offers ?? []).map((o) => o.key).filter((k) => k !== l.report.recommended_offer).map(offerName).join("; "),
    call_questions: (l.report.discovery_questions ?? []).join("\n"),
  };
}

/** The leads an import may target: all researched open leads, blocked if emails are already waiting. */
export function importIndex(leads: ResearchedLead[]): ImportLead[] {
  return leads.map((l) => ({
    company_id: l.company.id, name: l.company.name, lead_ref: l.company.lead_ref, time_zone: leadTimeZone(l.company),
    contacts: l.contacts.map((c) => ({ id: c.id, email: c.email! })),
    blocked: l.waiting ? "it already has emails waiting (approve, edit or cancel those first)" : null,
  }));
}
