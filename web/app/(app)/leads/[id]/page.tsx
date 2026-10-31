import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowLeft, Building2, Clock, ExternalLink, Globe, Handshake, Mail, MapPin, MessageSquarePlus, Phone, Pin,
  ShieldAlert, ShieldCheck, Sparkles, UserPlus,
} from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { teamMembers } from "@/lib/team";
import {
  CHANNEL_LABEL, CHANNELS, OUTCOME_LABEL, OUTCOMES, STAGE_LABEL, STAGES, memberName,
  type Channel, type Outcome, type Stage,
} from "@/lib/crm";
import { TEAM_TZ, ago, dateTime, isoToTeamLocal, localNow, minutes, money } from "@/lib/format";
import { addContact, addNote, logTouch, updateLead } from "../actions";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { ResearchReportCard, WhatToSell } from "@/components/research-cards";
import { isOfferKey, type RecommendedOffer } from "@/lib/offers";
import { StageBadge } from "@/components/stage-badge";
import { MemberAvatar } from "@/components/member-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type Company = Record<string, unknown> & {
  id: string; name: string; stage: Stage; owner_id: string | null; country: string | null; time_zone: string | null;
  enrichment: Record<string, string> | null; score_breakdown: { reasons?: { points?: number; reason: string }[] } | null;
};
type Contact = { id: string; full_name: string | null; role: string | null; email: string | null; phone: string | null;
  consent_basis: string; email_is_role: boolean | null; do_not_contact: boolean; source_url: string | null };
type Report = {
  id: string; source: string; summary: string; recommended_offer: string | null; hook: string | null;
  gaps: { gap: string; evidence_url: string; detail?: string }[]; discovery_questions: string[]; confidence: number | null;
  raw: Record<string, string> | null; created_by: string | null; created_at: string; updated_at: string;
};
type Touch = { id: string; member_id: string | null; channel: Channel; outcome: Outcome; minutes: number; summary: string | null; happened_at: string };
type Note = { id: string; member_id: string | null; body: string; pinned: boolean; created_at: string };
type Activity = { id: string; member_id: string | null; actor: string; type: string; payload: Record<string, unknown>; created_at: string };

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const href = (v: string) => (/^https?:/i.test(v) ? v : `https://${v}`);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("companies").select("name").eq("id", (await params).id).maybeSingle();
  return { title: data?.name ?? "Lead" };
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const [team, companyRes, contactsRes, touchesRes, notesRes, actsRes, auditRes, reportRes] = await Promise.all([
    teamMembers(),
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    supabase.from("contacts").select("id,full_name,role,email,phone,consent_basis,email_is_role,do_not_contact,source_url").eq("company_id", id).order("created_at"),
    supabase.from("touches").select("id,member_id,channel,outcome,minutes,summary,happened_at").eq("company_id", id).order("happened_at", { ascending: false }).limit(200),
    supabase.from("notes").select("id,member_id,body,pinned,created_at").eq("company_id", id).order("created_at", { ascending: false }),
    supabase.from("activities").select("id,member_id,actor,type,payload,created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("website_audits").select("signals,error,fetched_at").eq("company_id", id).order("fetched_at", { ascending: false }).limit(1),
    supabase.from("research_reports").select("id,source,summary,recommended_offer,hook,gaps,discovery_questions,confidence,raw,created_by,created_at,updated_at")
      .eq("company_id", id).order("created_at", { ascending: false }).limit(1),
  ]);
  const c = companyRes.data as Company | null;
  if (!c) notFound();

  const contacts = (contactsRes.data ?? []) as Contact[];
  const touches = (touchesRes.data ?? []) as Touch[];
  const notes = (notesRes.data ?? []) as Note[];
  const acts = (actsRes.data ?? []) as Activity[];
  const audit = auditRes.data?.[0] as { signals: Record<string, unknown>; error: string | null } | undefined;
  const report = reportRes.data?.[0] as Report | undefined;
  const offers = ((c.recommended_offers as RecommendedOffer[] | null) ?? []).filter((o) => isOfferKey(o.key));
  const who = (mid: string | null, fallback = "System") => (mid ? memberName(team.find((m) => m.id === mid)) : fallback);
  const leadTime = c.time_zone ? localNow(c.time_zone) : null;
  const nowLocal = isoToTeamLocal(new Date().toISOString());

  const enrichment = Object.entries(c.enrichment ?? {}).filter(([, v]) => s(v));
  const facts = enrichment.filter(([k, v]) => v.length <= 48 && !/url$/i.test(k));
  const longFacts = enrichment.filter(([k, v]) => v.length > 48 && !/url$/i.test(k));
  const links = enrichment.filter(([k]) => /url$/i.test(k));

  const sig = audit?.signals ?? {};
  const signals: [string, boolean][] = audit && !audit.error ? [
    ["Online booking", !!sig.has_online_booking], ["Chat widget", !!sig.has_chat_widget], ["Text-us link", !!sig.has_sms_cta],
    ["Review widget", !!sig.has_review_widget], ["Runs ads", !!sig.has_ad_pixel], ["On GoHighLevel", !!sig.uses_ghl],
    ["Mobile friendly", !!sig.mobile_viewport], ["HTTPS", !!sig.https],
  ] : [];
  const socials = (["website", "facebook", "instagram", "linkedin", "yelp"] as const).map((k) => [k, s(c[k])] as const).filter(([, v]) => v);

  const timeline = [
    ...touches.map((t) => ({ at: t.happened_at, key: `t${t.id}`, kind: "touch" as const, t })),
    ...notes.map((n) => ({ at: n.created_at, key: `n${n.id}`, kind: "note" as const, n })),
    ...acts.map((a) => ({ at: a.created_at, key: `a${a.id}`, kind: "act" as const, a })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  const actText = (a: Activity) => {
    const p = a.payload ?? {};
    if (a.type === "stage_changed") return <>moved stage <b>{STAGE_LABEL[p.from as Stage] ?? String(p.from)}</b> → <b>{STAGE_LABEL[p.to as Stage] ?? String(p.to)}</b></>;
    if (a.type === "owner_changed") return <>set owner to <b>{p.to ? who(p.to as string) : "Unassigned"}</b></>;
    if (a.type === "audited") return <>website checked (score {String(p.score ?? "—")})</>;
    if (a.type === "discovered") return <>lead added</>;
    if (a.type === "email_verified") return <>email verified: {String(p.status ?? "")}</>;
    return <>{a.type.replace(/_/g, " ")}</>;
  };

  return (
    <>
      <div className="space-y-3">
        <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Leads</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <StageBadge stage={c.stage} />
              {s(c.trade) && <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" />{c.trade as string}</span>}
              <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{[s(c.city), s(c.region), s(c.country)].filter(Boolean).join(", ") || "—"}</span>
              {leadTime && <Badge variant="secondary" className="font-normal"><Clock />Their time {leadTime}</Badge>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Score", c.score != null ? String(c.score) : "—", s(c.tier) ?? ""],
              ["Time spent", minutes(c.minutes_spent as number), "all time"],
              ["Touches", String(c.touches_count ?? 0), c.last_touch_at ? `last ${ago(c.last_touch_at as string)}` : "none yet"],
            ].map(([label, value, sub]) => (
              <div key={label} className="min-w-24 rounded-lg border bg-card px-3 py-2">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="text-lg font-semibold tabular-nums">{value}</div>
                <div className="text-[11px] text-muted-foreground capitalize">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <WhatToSell offers={offers} researched={report?.recommended_offer ?? null} />
          {report && <ResearchReportCard report={report} by={report.created_by ? who(report.created_by) : null} />}
          <Card className="border-primary/20 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Handshake className="size-4" />Log activity</CardTitle>
              <CardDescription>Record what you did and how long it took. The stage moves forward automatically.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={logTouch.bind(null, c.id)} success="Activity logged" reset className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Field label="Channel">
                  <Select name="channel" defaultValue="call">
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{CHANNELS.map((ch) => <SelectItem key={ch} value={ch}>{CHANNEL_LABEL[ch]}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Outcome">
                  <Select name="outcome" defaultValue="done">
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{OUTCOMES.map((o) => <SelectItem key={o} value={o}>{OUTCOME_LABEL[o]}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Minutes spent">
                  <Input name="minutes" type="number" inputMode="numeric" min={0} max={600} required defaultValue={5} className="text-base font-semibold tabular-nums" />
                </Field>
                <Field label={`When (${TEAM_TZ})`}>
                  <Input name="happened_at" type="datetime-local" defaultValue={nowLocal} />
                </Field>
                {contacts.length > 0 && (
                  <Field label="With" className="col-span-2">
                    <Select name="contact_id">
                      <SelectTrigger className="w-full"><SelectValue placeholder="Optional" /></SelectTrigger>
                      <SelectContent>{contacts.map((ct) => <SelectItem key={ct.id} value={ct.id}>{ct.full_name || ct.email || ct.phone}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                )}
                <Field label="Summary" className="col-span-2 md:col-span-4">
                  <Textarea name="summary" rows={2} placeholder="What happened?" />
                </Field>
                <Field label="Next step (optional)" className="col-span-2">
                  <Input name="next_step" placeholder="e.g. Call back Tuesday" />
                </Field>
                <Field label="Next step date" className="col-span-2">
                  <Input name="next_step_at" type="datetime-local" />
                </Field>
                <div className="col-span-2 md:col-span-4"><SubmitButton className="w-full sm:w-auto">Log activity</SubmitButton></div>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <CardContent>
              {timeline.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p> : (
                <ol className="relative space-y-5 border-l pl-6">
                  {timeline.map((e) => {
                    const mid = e.kind === "touch" ? e.t.member_id : e.kind === "note" ? e.n.member_id : e.a.member_id;
                    return (
                      <li key={e.key} className="relative">
                        <span className="absolute top-0 -left-[2.3rem]"><MemberAvatar team={team} id={mid} className="ring-4 ring-card" /></span>
                        <div className="text-xs text-muted-foreground">{dateTime(e.at)} · {ago(e.at)}</div>
                        {e.kind === "touch" && (
                          <div className="mt-0.5 text-sm">
                            <span className="font-medium">{who(e.t.member_id, "Someone")}</span>{" "}
                            <span className="text-muted-foreground">{CHANNEL_LABEL[e.t.channel].toLowerCase()} ·</span>{" "}
                            <Badge variant="outline" className="font-normal">{OUTCOME_LABEL[e.t.outcome]}</Badge>{" "}
                            <span className="font-medium tabular-nums">{minutes(e.t.minutes)}</span>
                            {e.t.summary && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{e.t.summary}</p>}
                          </div>
                        )}
                        {e.kind === "note" && (
                          <div className="mt-0.5 text-sm">
                            <span className="font-medium">{who(e.n.member_id, "Someone")}</span> <span className="text-muted-foreground">added a note</span>
                            {e.n.pinned && <Pin className="ml-1 inline size-3.5 text-amber-600" />}
                            <p className="mt-1 whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-950">{e.n.body}</p>
                          </div>
                        )}
                        {e.kind === "act" && (
                          <div className="mt-0.5 text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">{who(e.a.member_id, e.a.actor === "claude" ? "Claude" : "System")}</span> {actText(e.a)}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Status</CardTitle></CardHeader>
            <CardContent>
              <ActionForm action={updateLead.bind(null, c.id)} success="Lead saved" className="space-y-4">
                <Field label="Stage">
                  <Select name="stage" defaultValue={c.stage}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map((st) => <SelectItem key={st} value={st}>{STAGE_LABEL[st]}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Owner">
                  <Select name="owner_id" defaultValue={c.owner_id ?? "none"}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {team.map((m) => <SelectItem key={m.id} value={m.id}>{memberName(m)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Next step"><Input name="next_step" defaultValue={s(c.next_step) ?? ""} placeholder="What happens next?" /></Field>
                <Field label={`Next step date (${TEAM_TZ})`}>
                  <Input name="next_step_at" type="datetime-local" defaultValue={isoToTeamLocal(c.next_step_at as string | null)} />
                </Field>
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <Field label="Deal value">
                    <Input name="deal_value" inputMode="decimal" placeholder="0"
                      defaultValue={c.deal_value_cents != null ? String((c.deal_value_cents as number) / 100) : ""} />
                  </Field>
                  <Field label="Currency">
                    <Select name="deal_currency" defaultValue={(c.deal_currency as string) ?? "USD"}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CAD">CAD</SelectItem></SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field label="Lost reason"><Input name="lost_reason" defaultValue={s(c.lost_reason) ?? ""} placeholder="Only if lost" /></Field>
                <SubmitButton className="w-full">Save changes</SubmitButton>
                {c.deal_value_cents != null && (
                  <p className="text-center text-xs text-muted-foreground">Deal {money(c.deal_value_cents as number, (c.deal_currency as string) ?? "USD")}</p>
                )}
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Company</CardTitle></CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              {s(c.phone) && <a className="flex items-center gap-2 hover:underline" href={`tel:${c.phone}`}><Phone className="size-4 text-muted-foreground" />{c.phone as string}</a>}
              {s(c.email) && <a className="flex items-center gap-2 break-all hover:underline" href={`mailto:${c.email}`}><Mail className="size-4 shrink-0 text-muted-foreground" />{c.email as string}</a>}
              {s(c.website) && <a className="flex items-center gap-2 break-all hover:underline" href={href(c.website as string)} target="_blank" rel="noreferrer"><Globe className="size-4 shrink-0 text-muted-foreground" />{(c.website_domain as string) ?? (c.website as string)}</a>}
              {s(c.address) && <div className="flex gap-2 text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" />{[s(c.address), s(c.city), s(c.region), s(c.postal_code)].filter(Boolean).join(", ")}</div>}
              {s(c.opening_hours) && <div className="flex gap-2 text-muted-foreground"><Clock className="mt-0.5 size-4 shrink-0" />{c.opening_hours as string}</div>}
              {(socials.length > 0 || !!c.is_chain) && <Separator />}
              <div className="flex flex-wrap gap-1.5">
                {socials.filter(([k]) => k !== "website").map(([k, v]) => (
                  <Button key={k} variant="outline" size="sm" asChild className="h-7 capitalize">
                    <a href={href(v!)} target="_blank" rel="noreferrer">{k}<ExternalLink className="size-3" /></a>
                  </Button>
                ))}
                {c.is_chain ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Chain / franchise</Badge> : null}
              </div>
            </CardContent>
          </Card>

          {(signals.length > 0 || facts.length > 0 || longFacts.length > 0 || audit?.error) && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4" />Signals</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {audit?.error && <p className="text-xs text-muted-foreground">Website check failed: {audit.error}</p>}
                {signals.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {signals.map(([label, on]) => (
                      <Badge key={label} variant="outline" className={on ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "text-muted-foreground line-through decoration-muted-foreground/60"}>{label}</Badge>
                    ))}
                  </div>
                )}
                {facts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {facts.map(([k, v]) => <Badge key={k} variant="secondary" className="font-normal"><span className="text-muted-foreground">{k.replace(/_/g, " ")}:</span> {v}</Badge>)}
                  </div>
                )}
                {longFacts.map(([k, v]) => <p key={k} className="text-muted-foreground"><span className="font-medium text-foreground capitalize">{k.replace(/_/g, " ")}: </span>{v}</p>)}
                {links.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">{k.replace(/_/g, " ")}<ExternalLink className="size-3" /></a>)}
              </CardContent>
            </Card>
          )}

          {(c.score_breakdown?.reasons?.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle>Why this score</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {c.score_breakdown!.reasons!.map((r, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{r.reason}</span>
                      {r.points != null && <span className={`shrink-0 font-medium tabular-nums ${r.points < 0 ? "text-rose-600" : "text-emerald-700"}`}>{r.points > 0 ? "+" : ""}{r.points}</span>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Contacts</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {contacts.length === 0 && <p className="text-sm text-muted-foreground">No contacts yet.</p>}
              {contacts.map((ct) => (
                <div key={ct.id} className="space-y-1.5 rounded-lg border p-3 text-sm">
                  <div className="font-medium">{ct.full_name || "Unnamed"}{ct.role && <span className="font-normal text-muted-foreground"> · {ct.role}</span>}</div>
                  {ct.email && <a href={`mailto:${ct.email}`} className="block break-all text-muted-foreground hover:text-foreground hover:underline">{ct.email}</a>}
                  {ct.phone && <a href={`tel:${ct.phone}`} className="block text-muted-foreground hover:text-foreground hover:underline">{ct.phone}</a>}
                  {ct.source_url && /^https?:/i.test(ct.source_url) && (
                    <a href={ct.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                      <ExternalLink className="size-3" />Source
                    </a>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {ct.role === "owner" && <Badge variant="secondary" className="font-normal">Owner</Badge>}
                    {ct.email && (ct.consent_basis === "unknown"
                      ? <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700"><ShieldAlert />No consent basis · don&apos;t email</Badge>
                      : <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><ShieldCheck />{ct.consent_basis.replace(/_/g, " ")}</Badge>)}
                    {ct.email_is_role && <Badge variant="secondary" className="font-normal">Shared inbox</Badge>}
                    {ct.do_not_contact && <Badge variant="destructive">Do not contact</Badge>}
                  </div>
                </div>
              ))}
              <Collapsible>
                <CollapsibleTrigger asChild><Button variant="outline" size="sm" className="w-full"><UserPlus />Add contact</Button></CollapsibleTrigger>
                <CollapsibleContent>
                  <ActionForm action={addContact.bind(null, c.id, c.country)} success="Contact added" reset className="mt-3 space-y-2">
                    <Input name="full_name" placeholder="Name" />
                    <Input name="role" placeholder="Role (owner, office manager…)" />
                    <Input name="email" type="email" placeholder="Email" />
                    <Input name="phone" placeholder="Phone" />
                    <Input name="source_url" type="url" placeholder="Where you found it (URL)" />
                    {c.country === "CA" && (
                      <label className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Checkbox name="published_on_own_site" className="mt-0.5" />
                        Email is published on their own website, with no &quot;no unsolicited email&quot; notice (CASL)
                      </label>
                    )}
                    <SubmitButton className="w-full" size="sm">Save contact</SubmitButton>
                  </ActionForm>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquarePlus className="size-4" />Add a note</CardTitle></CardHeader>
            <CardContent>
              <ActionForm action={addNote.bind(null, c.id)} success="Note added" reset className="space-y-3">
                <Textarea name="body" rows={3} required placeholder="Anything worth remembering" />
                <label className="flex items-center gap-2 text-sm text-muted-foreground"><Checkbox name="pinned" />Pin this note</label>
                <SubmitButton className="w-full" variant="secondary">Add note</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
