import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { teamMembers } from "@/lib/team";
import {
  CHANNEL_LABEL, CHANNELS, OUTCOME_LABEL, OUTCOMES, STAGE_COLOR, STAGE_LABEL, STAGES, memberName,
  type Channel, type Outcome, type Stage,
} from "@/lib/crm";
import { TEAM_TZ, ago, dateTime, isoToTeamLocal, localNow, minutes, money } from "@/lib/format";
import { addContact, addNote, logTouch, updateLead } from "../actions";
import { SubmitButton } from "@/components/submit-button";

type Company = Record<string, unknown> & {
  id: string; name: string; stage: Stage; owner_id: string | null; country: string | null; time_zone: string | null;
  enrichment: Record<string, string> | null; score_breakdown: { reasons?: { points?: number; reason: string }[] } | null;
};
type Contact = { id: string; full_name: string | null; role: string | null; email: string | null; phone: string | null;
  consent_basis: string; email_status: string | null; email_is_role: boolean | null; source_url: string | null; do_not_contact: boolean };
type Touch = { id: string; member_id: string | null; channel: Channel; outcome: Outcome; minutes: number; summary: string | null; happened_at: string };
type Note = { id: string; member_id: string | null; body: string; pinned: boolean; created_at: string };
type Activity = { id: string; member_id: string | null; actor: string; type: string; payload: Record<string, unknown>; created_at: string };

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const [team, companyRes, contactsRes, touchesRes, notesRes, actsRes, auditRes] = await Promise.all([
    teamMembers(),
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    supabase.from("contacts").select("id,full_name,role,email,phone,consent_basis,email_status,email_is_role,source_url,do_not_contact").eq("company_id", id).order("created_at"),
    supabase.from("touches").select("id,member_id,channel,outcome,minutes,summary,happened_at").eq("company_id", id).order("happened_at", { ascending: false }).limit(200),
    supabase.from("notes").select("id,member_id,body,pinned,created_at").eq("company_id", id).order("created_at", { ascending: false }),
    supabase.from("activities").select("id,member_id,actor,type,payload,created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("website_audits").select("signals,error,fetched_at").eq("company_id", id).order("fetched_at", { ascending: false }).limit(1),
  ]);
  const c = companyRes.data as Company | null;
  if (!c) notFound();

  const contacts = (contactsRes.data ?? []) as Contact[];
  const touches = (touchesRes.data ?? []) as Touch[];
  const notes = (notesRes.data ?? []) as Note[];
  const acts = (actsRes.data ?? []) as Activity[];
  const audit = auditRes.data?.[0] as { signals: Record<string, unknown>; error: string | null; fetched_at: string } | undefined;
  const byId = new Map(team.map((m) => [m.id, m]));
  const who = (mid: string | null, fallback = "System") => (mid ? memberName(byId.get(mid)) : fallback);
  const owner = c.owner_id ? byId.get(c.owner_id) : null;
  const leadTime = c.time_zone ? localNow(c.time_zone) : null;
  const nowLocal = isoToTeamLocal(new Date().toISOString());

  const enrichment = Object.entries(c.enrichment ?? {}).filter(([, v]) => s(v));
  const shortFacts = enrichment.filter(([k, v]) => v.length <= 48 && !/url$/i.test(k));
  const longFacts = enrichment.filter(([k, v]) => v.length > 48 && !/url$/i.test(k));
  const links = enrichment.filter(([k]) => /url$/i.test(k));

  const signals = audit?.signals ?? {};
  const signalChips: [string, boolean][] = audit && !audit.error ? [
    ["Online booking", !!signals.has_online_booking], ["Chat widget", !!signals.has_chat_widget],
    ["Text-us link", !!signals.has_sms_cta], ["Review widget", !!signals.has_review_widget],
    ["Runs ads", !!signals.has_ad_pixel], ["On GoHighLevel", !!signals.uses_ghl],
    ["Mobile friendly", !!signals.mobile_viewport], ["HTTPS", !!signals.https],
  ] : [];

  const socials = (["website", "facebook", "instagram", "linkedin", "yelp"] as const)
    .map((k) => [k, s(c[k])] as const).filter(([, v]) => v);

  const timeline = [
    ...touches.map((t) => ({ at: t.happened_at, key: `t${t.id}`, kind: "touch" as const, t })),
    ...notes.map((n) => ({ at: n.created_at, key: `n${n.id}`, kind: "note" as const, n })),
    ...acts.map((a) => ({ at: a.created_at, key: `a${a.id}`, kind: "act" as const, a })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  const actText = (a: Activity) => {
    const p = a.payload ?? {};
    if (a.type === "stage_changed") return `moved stage ${STAGE_LABEL[p.from as Stage] ?? p.from} → ${STAGE_LABEL[p.to as Stage] ?? p.to}`;
    if (a.type === "owner_changed") return `changed owner ${p.from ? memberName(byId.get(p.from as string)) : "Unassigned"} → ${p.to ? memberName(byId.get(p.to as string)) : "Unassigned"}`;
    if (a.type === "audited") return `website audited (score ${p.score ?? "—"})`;
    if (a.type === "discovered") return "lead added";
    return a.type.replace(/_/g, " ");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/leads" className="text-sm text-slate-500 hover:underline">← Leads</Link>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className={`chip ${STAGE_COLOR[c.stage]}`}>{STAGE_LABEL[c.stage]}</span>
            <span>{[s(c.trade), s(c.city), s(c.region), s(c.country)].filter(Boolean).join(" · ")}</span>
            {leadTime && <span className="chip bg-slate-100 text-slate-700">Their time: {leadTime}</span>}
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="text-2xl font-semibold">{(c.score as number | null) ?? "—"}<span className="ml-1 text-sm font-normal text-slate-500">{s(c.tier)}</span></div>
          <div className="text-slate-500">{minutes(c.minutes_spent as number)} spent · {(c.touches_count as number) ?? 0} touches</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {/* Log activity: the main thing we do on this page */}
          <section className="card border-slate-300">
            <h2 className="mb-3 font-medium">Log activity</h2>
            <form action={logTouch.bind(null, c.id)} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="col-span-1"><span className="label">Channel</span>
                <select name="channel" required className="input w-full" defaultValue="call">
                  {CHANNELS.map((ch) => <option key={ch} value={ch}>{CHANNEL_LABEL[ch]}</option>)}
                </select>
              </label>
              <label className="col-span-1"><span className="label">Outcome</span>
                <select name="outcome" className="input w-full" defaultValue="done">
                  {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                </select>
              </label>
              <label className="col-span-1"><span className="label">Minutes spent</span>
                <input name="minutes" type="number" min={0} max={600} required defaultValue={5} className="input w-full text-lg font-semibold" />
              </label>
              <label className="col-span-1"><span className="label">When ({TEAM_TZ})</span>
                <input name="happened_at" type="datetime-local" defaultValue={nowLocal} className="input w-full" />
              </label>
              {contacts.length > 0 && (
                <label className="col-span-2"><span className="label">With</span>
                  <select name="contact_id" className="input w-full" defaultValue="">
                    <option value="">—</option>
                    {contacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.full_name || ct.email || ct.phone}</option>)}
                  </select>
                </label>
              )}
              <label className="col-span-2 sm:col-span-4"><span className="label">Summary</span>
                <textarea name="summary" rows={2} className="input w-full" placeholder="What happened?" />
              </label>
              <label className="col-span-2"><span className="label">Next step (optional)</span>
                <input name="next_step" className="input w-full" placeholder="e.g. Call back Tuesday" />
              </label>
              <label className="col-span-2"><span className="label">Next step date</span>
                <input name="next_step_at" type="datetime-local" className="input w-full" />
              </label>
              <div className="col-span-2 sm:col-span-4"><SubmitButton className="btn-primary w-full sm:w-auto">Log activity</SubmitButton></div>
            </form>
          </section>

          <section className="card">
            <h2 className="mb-3 font-medium">Timeline</h2>
            {timeline.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
            <ol className="space-y-3 text-sm">
              {timeline.map((e) => (
                <li key={e.key} className="border-l-2 border-slate-200 pl-3">
                  <div className="text-xs text-slate-400">{dateTime(e.at)} · {ago(e.at)}</div>
                  {e.kind === "touch" && (
                    <div>
                      <b>{who(e.t.member_id, "Someone")}</b> · {CHANNEL_LABEL[e.t.channel]} · {OUTCOME_LABEL[e.t.outcome]} · <span className="font-medium">{minutes(e.t.minutes)}</span>
                      {e.t.summary && <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{e.t.summary}</p>}
                    </div>
                  )}
                  {e.kind === "note" && (
                    <div>
                      <b>{who(e.n.member_id, "Someone")}</b> added a note{e.n.pinned && " 📌"}
                      <p className="mt-0.5 whitespace-pre-wrap rounded bg-amber-50 p-2 text-slate-700">{e.n.body}</p>
                    </div>
                  )}
                  {e.kind === "act" && (
                    <div className="text-slate-600"><b>{who(e.a.member_id, e.a.actor === "claude" ? "Claude" : "System")}</b> {actText(e.a)}</div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card">
            <h2 className="mb-3 font-medium">Status</h2>
            <form action={updateLead.bind(null, c.id)} className="space-y-3">
              <label className="block"><span className="label">Stage</span>
                <select name="stage" defaultValue={c.stage} className="input w-full">
                  {STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
                </select>
              </label>
              <label className="block"><span className="label">Owner</span>
                <select name="owner_id" defaultValue={c.owner_id ?? "none"} className="input w-full">
                  <option value="none">Unassigned</option>
                  {team.map((m) => <option key={m.id} value={m.id}>{memberName(m)}</option>)}
                </select>
              </label>
              <label className="block"><span className="label">Next step</span>
                <input name="next_step" defaultValue={s(c.next_step) ?? ""} className="input w-full" />
              </label>
              <label className="block"><span className="label">Next step date ({TEAM_TZ})</span>
                <input name="next_step_at" type="datetime-local" defaultValue={isoToTeamLocal(c.next_step_at as string | null)} className="input w-full" />
              </label>
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <label><span className="label">Deal value</span>
                  <input name="deal_value" inputMode="decimal" defaultValue={c.deal_value_cents != null ? String((c.deal_value_cents as number) / 100) : ""} className="input w-full" placeholder="0" />
                </label>
                <label><span className="label">Currency</span>
                  <select name="deal_currency" defaultValue={(c.deal_currency as string) ?? "USD"} className="input w-full"><option>USD</option><option>CAD</option></select>
                </label>
              </div>
              {(c.stage === "lost" || s(c.lost_reason)) && (
                <label className="block"><span className="label">Lost reason</span>
                  <input name="lost_reason" defaultValue={s(c.lost_reason) ?? ""} className="input w-full" />
                </label>
              )}
              <SubmitButton className="btn-primary w-full">Save</SubmitButton>
              <p className="text-xs text-slate-500">
                Owner: {owner ? memberName(owner) : "Unassigned"} · Deal {money(c.deal_value_cents as number | null, (c.deal_currency as string) ?? "USD")}
                {c.last_touch_at ? <> · last touch {ago(c.last_touch_at as string)}</> : null}
              </p>
            </form>
          </section>

          <section className="card space-y-2 text-sm">
            <h2 className="font-medium">Company</h2>
            {s(c.phone) && <div><a className="hover:underline" href={`tel:${c.phone}`}>{c.phone as string}</a></div>}
            {s(c.email) && <div><a className="hover:underline" href={`mailto:${c.email}`}>{c.email as string}</a></div>}
            {s(c.address) && <div className="text-slate-600">{[s(c.address), s(c.city), s(c.region), s(c.postal_code)].filter(Boolean).join(", ")}</div>}
            {s(c.opening_hours) && <div className="text-slate-600">Hours: {c.opening_hours as string}</div>}
            {c.time_zone ? <div className="text-slate-600">Time zone: {c.time_zone as string}</div> : null}
            {socials.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {socials.map(([k, v]) => (
                  <a key={k} href={/^https?:/.test(v!) ? v! : `https://${v}`} target="_blank" rel="noreferrer" className="chip bg-slate-100 text-slate-700 hover:bg-slate-200">{k}</a>
                ))}
              </div>
            )}
            {c.is_chain ? <div className="chip bg-amber-100 text-amber-800">Chain / franchise</div> : null}
          </section>

          {(signalChips.length > 0 || shortFacts.length > 0 || audit?.error) && (
            <section className="card space-y-3 text-sm">
              <h2 className="font-medium">Signals</h2>
              {audit?.error && <p className="text-xs text-slate-500">Website check failed: {audit.error}</p>}
              {signalChips.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {signalChips.map(([label, on]) => (
                    <span key={label} className={`chip ${on ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500 line-through"}`}>{label}</span>
                  ))}
                </div>
              )}
              {shortFacts.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {shortFacts.map(([k, v]) => <span key={k} className="chip bg-sky-50 text-sky-800">{k.replace(/_/g, " ")}: {v}</span>)}
                </div>
              )}
              {longFacts.map(([k, v]) => <p key={k} className="text-slate-600"><span className="label inline">{k.replace(/_/g, " ")}</span> {v}</p>)}
              {links.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="block truncate text-xs text-sky-700 hover:underline">{k.replace(/_/g, " ")}</a>)}
            </section>
          )}

          {(c.score_breakdown?.reasons?.length ?? 0) > 0 && (
            <section className="card text-sm">
              <h2 className="mb-2 font-medium">Why this score</h2>
              <ul className="space-y-1">
                {c.score_breakdown!.reasons!.map((r, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-slate-600">{r.reason}</span>
                    {r.points != null && <span className={r.points < 0 ? "text-rose-600" : "text-emerald-700"}>{r.points > 0 ? "+" : ""}{r.points}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card text-sm">
            <h2 className="mb-2 font-medium">Contacts</h2>
            <ul className="space-y-2">
              {contacts.map((ct) => (
                <li key={ct.id} className="rounded-md border border-slate-100 p-2">
                  <div className="font-medium">{ct.full_name || "—"}{ct.role && <span className="font-normal text-slate-500"> · {ct.role}</span>}</div>
                  {ct.email && <a href={`mailto:${ct.email}`} className="block truncate hover:underline">{ct.email}</a>}
                  {ct.phone && <a href={`tel:${ct.phone}`} className="block hover:underline">{ct.phone}</a>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={`chip ${ct.consent_basis === "unknown" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {ct.consent_basis === "unknown" ? "no consent basis (don't email)" : ct.consent_basis.replace(/_/g, " ")}
                    </span>
                    {ct.email_is_role && <span className="chip bg-slate-100 text-slate-600">shared inbox</span>}
                    {ct.do_not_contact && <span className="chip bg-rose-100 text-rose-800">do not contact</span>}
                  </div>
                </li>
              ))}
            </ul>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-slate-600">Add contact</summary>
              <form action={addContact.bind(null, c.id, c.country)} className="mt-2 space-y-2">
                <input name="full_name" placeholder="Name" className="input w-full" />
                <input name="role" placeholder="Role (owner, office manager…)" className="input w-full" />
                <input name="email" type="email" placeholder="Email" className="input w-full" />
                <input name="phone" placeholder="Phone" className="input w-full" />
                <input name="source_url" type="url" placeholder="Where you found it (URL)" className="input w-full" />
                {c.country === "CA" && (
                  <label className="flex items-start gap-2 text-xs text-slate-600">
                    <input type="checkbox" name="published_on_own_site" className="mt-0.5" />
                    Email is published on their own website, with no &quot;no unsolicited email&quot; notice (CASL)
                  </label>
                )}
                <SubmitButton className="btn w-full">Add contact</SubmitButton>
              </form>
            </details>
          </section>

          <section className="card text-sm">
            <h2 className="mb-2 font-medium">Add a note</h2>
            <form action={addNote.bind(null, c.id)} className="space-y-2">
              <textarea name="body" rows={3} required className="input w-full" placeholder="Anything worth remembering" />
              <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="pinned" /> Pin</label>
              <SubmitButton className="btn w-full">Add note</SubmitButton>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
