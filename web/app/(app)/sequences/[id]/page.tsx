import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, CheckCheck, Pause, Play, UserPlus, X } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/crm";
import { TEAM_TZ } from "@/lib/format";
import { approveAllDrafts, enrollByFilter, removeFromSequence, setSequenceStatus } from "../actions";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { SequenceEditor } from "@/components/sequence-editor";
import { StageBadge } from "@/components/stage-badge";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const metadata: Metadata = { title: "Sequence" };
export const dynamic = "force-dynamic";

type Campaign = { id: string; name: string; description: string | null; status: string; template_ids: string[]; step_days: number[]; send_time: string; skip_weekends: boolean };
type Member = { company_id: string; contact_id: string; created_at: string; stopped_reason: string | null;
  companies: { name: string; stage: Stage } | null;
  contacts: { email: string | null; full_name: string | null } | null };
type Msg = { company_id: string; step: number; status: string; scheduled_for: string | null; sent_at: string | null; member_id: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: TEAM_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const CLOSED = ["won", "lost", "disqualified"];

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  // Everything that doesn't need the sequence's own row is loaded alongside it.
  const [{ member: me }, { data: cp }, memRes, msgRes, sumRes, inboxRes, facetsRes, hookRes] = await Promise.all([
    currentMember(),
    supabase.from("campaigns").select("id,name,description,status,template_ids,step_days,send_time,skip_weekends").eq("id", id).maybeSingle(),
    supabase.from("campaign_members").select("company_id,contact_id,created_at,stopped_reason,companies(name,stage),contacts(email,full_name)")
      .eq("campaign_id", id).order("created_at", { ascending: false }).limit(300),
    supabase.from("outreach_messages").select("company_id,step,status,scheduled_for,sent_at,member_id").eq("campaign_id", id).limit(3000),
    supabase.rpc("sequence_summary"),
    supabase.rpc("my_mail_accounts"),
    supabase.from("v_lead_facets").select("region,trade,leads"),
    supabase.from("research_reports").select("company_id").not("hook", "is", null).limit(1).maybeSingle(),
  ]);
  if (!cp) notFound();
  const c = cp as Campaign;
  const tplRes = c.template_ids.length ? await supabase.from("templates").select("id,subject,body").in("id", c.template_ids) : null;
  const tpl = new Map(((tplRes?.data ?? []) as { id: string; subject: string; body: string }[]).map((t) => [t.id, t]));
  const steps = c.template_ids.map((tid, i) => ({
    template_id: tid, day: c.step_days[i] ?? i * 4 + 1, subject: tpl.get(tid)?.subject ?? "", body: tpl.get(tid)?.body ?? "",
  }));
  const members = (memRes.data ?? []) as unknown as Member[];
  const msgs = (msgRes.data ?? []) as Msg[];
  const sum = ((sumRes.data ?? []) as { campaign_id: string; leads: number; needs_approval: number; scheduled: number; sent: number; replied: number }[])
    .find((s) => s.campaign_id === id);
  const myDrafts = msgs.filter((m) => m.status === "pending_approval" && m.member_id === me?.id).length;
  const inboxes = (inboxRes.data ?? []) as { id: string; email: string }[];
  const facets = (facetsRes.data ?? []) as { region: string | null; trade: string | null }[];
  const regions = [...new Set(facets.map((f) => f.region).filter(Boolean))].sort() as string[];
  const trades = [...new Set(facets.map((f) => f.trade).filter(Boolean))].sort() as string[];

  // A real lead to preview the steps with: the newest one in the sequence, else one with research.
  let sample: Parameters<typeof SequenceEditor>[0]["sample"] = null;
  const sampleId = members[0]?.company_id
    ?? hookRes.data?.company_id;
  if (sampleId) {
    const [{ data: co }, { data: ct }, { data: rr }] = await Promise.all([
      supabase.from("companies").select("name,city,trade,niche,website").eq("id", sampleId).maybeSingle(),
      supabase.from("contacts").select("full_name").eq("company_id", sampleId).not("email", "is", null).order("created_at").limit(1).maybeSingle(),
      supabase.from("research_reports").select("hook").eq("company_id", sampleId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (co) {
      sample = {
        label: co.name, company: co.name, city: co.city, trade: co.trade ?? co.niche, website: co.website,
        full_name: ct?.full_name ?? null, first_name: ct?.full_name?.trim().split(/\s+/)[0] ?? null, personal_line: rr?.hook ?? null,
        my_name: me?.full_name?.trim().split(/\s+/)[0] ?? null,
      };
    }
  }

  const perLead = new Map<string, Msg[]>();
  for (const m of msgs) perLead.set(m.company_id, [...(perLead.get(m.company_id) ?? []), m]);
  const stats = sum ? ([["Leads", sum.leads], ["To approve", sum.needs_approval], ["Scheduled", sum.scheduled], ["Sent", sum.sent], ["Replied", sum.replied]] as const) : [];

  return (
    <>
      <Link href="/sequences" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Sequences</Link>
      <PageHeader title={c.name} description={c.description ?? `${steps.length} steps, sent at ${c.send_time.slice(0, 5)} in each lead's time zone`}>
        <Badge variant="outline">{c.status === "active" ? "Active" : c.status === "paused" ? "Paused" : "Draft"}</Badge>
        {myDrafts > 0 && (
          <ActionForm action={approveAllDrafts.bind(null, id)}><SubmitButton size="sm"><CheckCheck />Approve my {myDrafts} draft{myDrafts === 1 ? "" : "s"}</SubmitButton></ActionForm>
        )}
        {c.status === "paused"
          ? <ActionForm action={setSequenceStatus.bind(null, id, "active")}><SubmitButton size="sm" variant="outline"><Play />Resume</SubmitButton></ActionForm>
          : <ActionForm action={setSequenceStatus.bind(null, id, "paused")}><SubmitButton size="sm" variant="outline"><Pause />Pause</SubmitButton></ActionForm>}
      </PageHeader>

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map(([k, v]) => (
            <Card key={k} className="py-4"><CardContent className="px-4"><div className="text-2xl font-semibold">{v}</div><div className="text-xs text-muted-foreground">{k}</div></CardContent></Card>
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
            <CardDescription>Each step is one email. Later steps without a subject go as a reply in the same thread. A reply, bounce or unsubscribe stops the rest for that lead.</CardDescription>
          </CardHeader>
          <CardContent>
            <SequenceEditor id={id} name={c.name} description={c.description} sendTime={c.send_time} skipWeekends={c.skip_weekends} steps={steps} sample={sample} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Add leads</CardTitle>
              <CardDescription>Best scores first. Emails are drafted from your inbox and wait for your approval; leads without an emailable contact are skipped. You can also add leads from the Leads table.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={enrollByFilter.bind(null, id)} className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5"><Label>Stage</Label>
                    <Select name="stage" defaultValue="ready"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any open stage</SelectItem>
                        {STAGES.filter((s) => !CLOSED.includes(s)).map((s) => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5"><Label>Trade</Label>
                    <Select name="trade" defaultValue="any"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="any">Any trade</SelectItem>{trades.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5"><Label>State / province</Label>
                    <Select name="region" defaultValue="any"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="any">Anywhere</SelectItem>{regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5"><Label htmlFor="min_score">Min score</Label><Input id="min_score" name="min_score" type="number" min={0} max={100} placeholder="0" /></div>
                  <div className="grid gap-1.5"><Label htmlFor="limit">How many</Label><Input id="limit" name="limit" type="number" min={1} max={200} defaultValue={20} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="start">Day 1</Label><Input id="start" name="start" type="date" /></div>
                </div>
                {inboxes.length > 1 && (
                  <div className="grid gap-1.5"><Label>Send from</Label>
                    <Select name="from_account" defaultValue="auto"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="auto">My default inbox</SelectItem>{inboxes.map((i) => <SelectItem key={i.id} value={i.id}>{i.email}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm"><Checkbox name="mine" />Only leads I own</label>
                <p className="text-xs text-muted-foreground">Leave Day 1 empty for today (or tomorrow, if the send time has already passed where the lead is).</p>
                <SubmitButton><UserPlus />Add leads</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="pb-4"><CardTitle>Leads in this sequence</CardTitle><CardDescription>{members.length} lead{members.length === 1 ? "" : "s"}</CardDescription></CardHeader>
            <CardContent className="px-0">
              {members.length === 0 ? <p className="px-6 pb-2 text-sm text-muted-foreground">None yet.</p> : (
                <ul className="divide-y border-t">
                  {members.map((m) => {
                    const mine = perLead.get(m.company_id) ?? [];
                    const sent = mine.filter((x) => x.status === "sent").length;
                    const next = mine.filter((x) => ["pending_approval", "approved", "queued"].includes(x.status))
                      .sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""))[0];
                    const stopped = !next && mine.some((x) => x.status === "cancelled");
                    return (
                      <li key={m.company_id} className="flex items-start gap-2 px-6 py-3 text-sm">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Link href={`/leads/${m.company_id}#email`} className="truncate font-medium hover:underline">{m.companies?.name ?? "Lead"}</Link>
                            {m.companies && <StageBadge stage={m.companies.stage} />}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{m.contacts?.full_name ? `${m.contacts.full_name} · ` : ""}{m.contacts?.email}</div>
                          <div className="text-xs text-muted-foreground">
                            {sent}/{steps.length} sent
                            {next ? ` · step ${next.step} ${next.status === "pending_approval" ? "needs approval," : "goes"} ${when(next.scheduled_for)}` : stopped ? " · stopped" : sent ? " · finished" : ""}
                          </div>
                        </div>
                        {next && (
                          <ActionForm action={removeFromSequence.bind(null, id, m.company_id)}>
                            <SubmitButton size="sm" variant="ghost"><X />Remove</SubmitButton>
                          </ActionForm>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
