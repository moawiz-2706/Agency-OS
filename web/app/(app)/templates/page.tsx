import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember, teamMembers } from "@/lib/team";
import { memberName } from "@/lib/crm";
import { DEFAULT_DESIGN, DEFAULT_MARKETING, normalizeDesign, normalizeMarketing } from "@/lib/mail/design";
import { EMAIL_RULES, LIBRARY } from "@/lib/email-library";
import { PageHeader } from "@/components/page-header";
import { EmailTemplates, type ScheduledEmail } from "@/components/email-templates";

export const metadata: Metadata = { title: "Templates" };
export const dynamic = "force-dynamic";

type Inbox = { email: string; signature: string | null; is_default: boolean; from_name: string | null };
type Row = {
  id: string; subject: string; body: string; step: number; status: string; scheduled_for: string | null; member_id: string | null;
  company_id: string; campaign_id: string | null; design?: string | null;
  companies: { name: string; city: string | null; trade: string | null; niche: string | null; website: string | null } | null;
  contacts: { full_name: string | null; email: string | null } | null;
};

const WAITING = ["draft", "pending_approval", "approved", "failed"];
const COLS = "id,subject,body,step,status,scheduled_for,member_id,company_id,campaign_id,companies(name,city,trade,niche,website),contacts(full_name,email)";

export default async function TemplatesPage() {
  const supabase = await supabaseServer();
  const [{ member }, team, designRes, marketingRes, inboxRes, withDesign] = await Promise.all([
    currentMember(),
    teamMembers(),
    supabase.rpc("email_design"),     // missing until migration 0014 runs
    supabase.rpc("email_marketing"),  // missing until migration 0015 runs
    supabase.rpc("my_mail_accounts"),
    supabase.from("outreach_messages").select(`${COLS},design`).in("status", WAITING).order("scheduled_for", { ascending: true, nullsFirst: false }).limit(600),
  ]);
  // Before migration 0015 there's no design column: read the emails without it.
  const emailsRes = withDesign.error
    ? await supabase.from("outreach_messages").select(COLS).in("status", WAITING).order("scheduled_for", { ascending: true, nullsFirst: false }).limit(600)
    : withDesign;
  const rows = ((emailsRes.data ?? []) as unknown as Row[]);
  const companyIds = [...new Set(rows.map((r) => r.company_id))];
  const [{ data: hooks }, { data: campaigns }] = await Promise.all([
    companyIds.length ? supabase.from("research_reports").select("company_id,hook").in("company_id", companyIds).not("hook", "is", null) : Promise.resolve({ data: [] }),
    marketingRes.error ? Promise.resolve({ data: [] }) : supabase.from("campaigns").select("id,design"),
  ]);
  const hookOf = new Map(((hooks ?? []) as { company_id: string; hook: string }[]).map((h) => [h.company_id, h.hook]));
  const campaignDesign = new Map(((campaigns ?? []) as { id: string; design: string | null }[]).map((c) => [c.id, c.design]));
  const nameOf = new Map(team.map((t) => [t.id, memberName(t)]));

  const scheduled: ScheduledEmail[] = rows.map((r) => ({
    id: r.id, subject: r.subject, body: r.body, step: r.step, status: r.status, scheduled_for: r.scheduled_for,
    design: (r.design ?? (r.campaign_id ? campaignDesign.get(r.campaign_id) : null) ?? "outreach") === "marketing" ? "marketing" : "outreach",
    mine: r.member_id === member?.id, author: (r.member_id && nameOf.get(r.member_id)) || "?",
    company_id: r.company_id, company: r.companies?.name ?? "?", to: r.contacts?.email ?? "", to_name: r.contacts?.full_name ?? null,
    vars: {
      first_name: r.contacts?.full_name?.trim().split(/\s+/)[0] ?? null, full_name: r.contacts?.full_name ?? null,
      company: r.companies?.name ?? null, city: r.companies?.city ?? null, trade: r.companies?.trade ?? r.companies?.niche ?? null,
      website: r.companies?.website ?? null, personal_line: hookOf.get(r.company_id) ?? null,
      my_name: ((r.member_id && nameOf.get(r.member_id)) || "").split(/\s+/)[0] || null,
    },
  }));

  const inboxes = (inboxRes.data as Inbox[] | null) ?? [];
  const inbox = inboxes.find((i) => i.is_default) ?? inboxes[0];
  const fallbackSig = `${memberName(member)}\nThe Sentinel Systems | https://thesentinelsystems.com\nYour postal address`;
  const isOwner = member?.role === "owner";

  return (
    <>
      <PageHeader title="Templates"
        description="How your emails look, every email waiting to go out, and ready-made sequences. Designs apply when each email is sent, including ones already scheduled." />
      {(designRes.error || marketingRes.error) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {designRes.error ? "Saving designs needs migrations 0014 and 0015" : "The marketing design and per-email designs need migration 0015"}: run it in
          Supabase (SQL Editor), then reload. You can still preview and fix emails below.
        </p>
      )}
      <EmailTemplates
        initial={designRes.error ? DEFAULT_DESIGN : normalizeDesign(designRes.data)}
        initialMarketing={marketingRes.error ? DEFAULT_MARKETING : normalizeMarketing(marketingRes.data)}
        canEdit={isOwner && !designRes.error}
        canEditMarketing={isOwner && !marketingRes.error}
        hasDesigns={!marketingRes.error}
        signature={inbox?.signature?.trim() || fallbackSig}
        fromName={inbox?.from_name || memberName(member)}
        fromEmail={inbox?.email ?? "you@thesentinelsystems.com"}
        isOwner={isOwner}
        library={LIBRARY}
        rules={EMAIL_RULES}
        scheduled={scheduled}
      />
    </>
  );
}
