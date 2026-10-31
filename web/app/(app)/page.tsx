import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { teamMembers } from "@/lib/team";
import {
  CHANNEL_LABEL, OUTCOME_LABEL, OUTREACH, POSITIVE, STAGE_LABEL, STAGES, memberName,
  type Channel, type Outcome, type Stage,
} from "@/lib/crm";
import { ago, dateTime, minutes } from "@/lib/format";

type Touch = {
  id: string; company_id: string; member_id: string | null; channel: Channel; outcome: Outcome;
  minutes: number; summary: string | null; happened_at: string;
  companies: { name: string } | null;
};

const RANGES = [7, 30, 90];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const days = RANGES.includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 7;
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const supabase = await supabaseServer();

  const [team, touchesRes, leadsRes, stageRes, overdueRes, latestRes] = await Promise.all([
    teamMembers(),
    supabase.from("touches").select("id,company_id,member_id,channel,outcome,minutes,summary,happened_at,companies(name)")
      .gte("happened_at", since).order("happened_at", { ascending: false }).limit(5000),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase.from("v_stage_counts").select("stage,owner_id,leads,minutes"),
    supabase.from("companies").select("id,name,next_step,next_step_at,owner_id")
      .lt("next_step_at", new Date().toISOString()).not("stage", "in", "(won,lost,disqualified)")
      .order("next_step_at").limit(15),
    supabase.from("touches").select("id,company_id,member_id,channel,outcome,minutes,summary,happened_at,companies(name)")
      .order("happened_at", { ascending: false }).limit(15),
  ]);

  const touches = (touchesRes.data ?? []) as unknown as Touch[];
  const stageRows = (stageRes.data ?? []) as { stage: Stage; owner_id: string | null; leads: number; minutes: number }[];
  const byId = new Map(team.map((m) => [m.id, m]));

  // Distinct leads per outcome in the period.
  const leadsWith = (pred: (t: Touch) => boolean) => new Set(touches.filter(pred).map((t) => t.company_id)).size;
  const kpis = [
    { label: "Leads", value: (leadsRes.count ?? 0).toLocaleString(), hint: "all time" },
    { label: "Contacted", value: leadsWith((t) => OUTREACH.includes(t.channel)) },
    { label: "Replied", value: leadsWith((t) => t.outcome === "replied") },
    { label: "Interested", value: leadsWith((t) => t.outcome === "interested") },
    { label: "Meetings", value: leadsWith((t) => t.outcome === "meeting_booked") },
    { label: "Won", value: leadsWith((t) => t.outcome === "won") },
    { label: "Time spent", value: minutes(touches.reduce((n, t) => n + t.minutes, 0)) },
    { label: "Touches", value: touches.length },
  ];

  // Where our time goes, per partner.
  const owned = new Map<string, number>();
  for (const r of stageRows) if (r.owner_id) owned.set(r.owner_id, (owned.get(r.owner_id) ?? 0) + r.leads);
  const perMember = [...team.map((m) => m.id), null].map((id) => {
    const mine = touches.filter((t) => t.member_id === id);
    return {
      id, name: id ? memberName(byId.get(id)) : "Unknown", color: id ? byId.get(id)?.color : "#94a3b8",
      minutes: mine.reduce((n, t) => n + t.minutes, 0),
      touches: mine.length,
      owned: id ? owned.get(id) ?? 0 : null,
      contacted: new Set(mine.filter((t) => OUTREACH.includes(t.channel)).map((t) => t.company_id)).size,
      positive: mine.filter((t) => POSITIVE.includes(t.outcome)).length,
      meetings: mine.filter((t) => t.outcome === "meeting_booked").length,
    };
  }).filter((r) => r.id || r.touches);

  const byChannel = Object.entries(touches.reduce<Record<string, { n: number; m: number }>>((acc, t) => {
    acc[t.channel] ??= { n: 0, m: 0 };
    acc[t.channel].n++; acc[t.channel].m += t.minutes;
    return acc;
  }, {})).sort((a, b) => b[1].m - a[1].m);
  const maxChannel = Math.max(1, ...byChannel.map(([, v]) => v.m));

  const pipeline = STAGES.map((s) => ({
    stage: s,
    leads: stageRows.filter((r) => r.stage === s).reduce((n, r) => n + r.leads, 0),
    minutes: stageRows.filter((r) => r.stage === s).reduce((n, r) => n + r.minutes, 0),
  }));
  const maxStage = Math.max(1, ...pipeline.map((p) => p.leads));

  const overdue = overdueRes.data ?? [];
  const latest = (latestRes.data ?? []) as unknown as Touch[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {RANGES.map((d) => (
            <Link key={d} href={`/?days=${d}`}
              className={`rounded px-3 py-1 ${d === days ? "bg-slate-900 text-white" : "text-slate-600"}`}>{d} days</Link>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {kpis.map((k) => (
          <div key={k.label} className="card p-3">
            <div className="text-xs text-slate-500">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold">{k.value}</div>
            <div className="text-[11px] text-slate-400">{k.hint ?? `last ${days} days`}</div>
          </div>
        ))}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="mb-3 font-medium">Where our time goes</h2>
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">Who</th><th>Time</th><th>Touches</th><th>Leads owned</th><th>Contacted</th><th>Positive</th><th>Meetings</th></tr>
          </thead>
          <tbody>
            {perMember.map((r) => (
              <tr key={r.id ?? "none"} className="border-t border-slate-100">
                <td className="py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.name}</td>
                <td className="font-medium">{minutes(r.minutes)}</td>
                <td>{r.touches}</td>
                <td>{r.owned ?? "—"}</td>
                <td>{r.contacted}</td>
                <td>{r.positive}</td>
                <td>{r.meetings}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-medium">Time by activity</h2>
          {byChannel.length === 0 && <p className="text-sm text-slate-500">No activity logged in this period.</p>}
          <ul className="space-y-2 text-sm">
            {byChannel.map(([ch, v]) => (
              <li key={ch}>
                <div className="flex justify-between"><span>{CHANNEL_LABEL[ch as Channel]}</span><span className="text-slate-500">{minutes(v.m)} · {v.n}×</span></div>
                <div className="mt-1 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-slate-700" style={{ width: `${(v.m / maxChannel) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="mb-3 font-medium">Pipeline <span className="text-xs font-normal text-slate-400">now, all time minutes</span></h2>
          <ul className="space-y-1.5 text-sm">
            {pipeline.map((p) => (
              <li key={p.stage}>
                <Link href={`/leads?stage=${p.stage}`} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2 hover:text-slate-600">
                  <span>{STAGE_LABEL[p.stage]}</span>
                  <span className="h-2 rounded bg-slate-100"><span className="block h-2 rounded bg-indigo-500" style={{ width: `${(p.leads / maxStage) * 100}%` }} /></span>
                  <span className="text-right text-slate-500">{p.leads} · {minutes(p.minutes)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="mb-3 font-medium">Overdue next steps</h2>
          {overdue.length === 0 && <p className="text-sm text-slate-500">Nothing overdue.</p>}
          <ul className="divide-y divide-slate-100 text-sm">
            {overdue.map((c) => (
              <li key={c.id} className="py-2">
                <Link href={`/leads/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                <div className="text-slate-500">
                  {c.next_step || "Next step"} · <span className="text-rose-600">due {ago(c.next_step_at)}</span>
                  {c.owner_id && <> · {memberName(byId.get(c.owner_id))}</>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="mb-3 font-medium">Latest activity</h2>
          {latest.length === 0 && <p className="text-sm text-slate-500">No activity yet. Open a lead and log what you did.</p>}
          <ul className="divide-y divide-slate-100 text-sm">
            {latest.map((t) => (
              <li key={t.id} className="py-2">
                <div className="flex justify-between gap-2">
                  <span>
                    <b>{t.member_id ? memberName(byId.get(t.member_id)) : "Someone"}</b>{" "}
                    {CHANNEL_LABEL[t.channel].toLowerCase()} · {OUTCOME_LABEL[t.outcome].toLowerCase()} ·{" "}
                    <Link href={`/leads/${t.company_id}`} className="hover:underline">{t.companies?.name}</Link>
                  </span>
                  <span className="shrink-0 text-slate-500">{minutes(t.minutes)}</span>
                </div>
                <div className="text-xs text-slate-400">{dateTime(t.happened_at)}{t.summary && ` · ${t.summary.slice(0, 90)}`}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
