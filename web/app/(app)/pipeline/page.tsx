import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { teamMembers } from "@/lib/team";
import { OPEN_STAGES, STAGE_COLOR, STAGE_LABEL, memberName, type Stage } from "@/lib/crm";
import { ago, minutes } from "@/lib/format";

const PER_COLUMN = 40;

type Card = { id: string; name: string; city: string | null; region: string | null; owner_id: string | null;
  last_touch_at: string | null; minutes_spent: number; score: number | null };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const { owner } = await searchParams;
  const supabase = await supabaseServer();
  const team = await teamMembers();
  const byId = new Map(team.map((m) => [m.id, m]));

  // One query per column keeps each one sorted and capped; counts come from the view.
  const [counts, ...columns] = await Promise.all([
    supabase.from("v_stage_counts").select("stage,owner_id,leads,minutes"),
    ...OPEN_STAGES.map((stage) => {
      let q = supabase.from("companies").select("id,name,city,region,owner_id,last_touch_at,minutes_spent,score").eq("stage", stage);
      if (owner === "none") q = q.is("owner_id", null);
      else if (owner) q = q.eq("owner_id", owner);
      return q.order("last_touch_at", { ascending: false, nullsFirst: false }).order("score", { ascending: false, nullsFirst: false }).limit(PER_COLUMN);
    }),
  ]);
  const countRows = ((counts.data ?? []) as { stage: Stage; owner_id: string | null; leads: number; minutes: number }[])
    .filter((r) => !owner || (owner === "none" ? r.owner_id === null : r.owner_id === owner));
  const total = (s: Stage) => countRows.filter((r) => r.stage === s).reduce((n, r) => n + r.leads, 0);
  const mins = (s: Stage) => countRows.filter((r) => r.stage === s).reduce((n, r) => n + r.minutes, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Pipeline</h1>
        <div className="flex flex-wrap gap-1 text-sm">
          <Link href="/pipeline" className={`rounded-md px-2 py-1 ${!owner ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>Everyone</Link>
          {team.map((m) => (
            <Link key={m.id} href={`/pipeline?owner=${m.id}`}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${owner === m.id ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />{memberName(m)}
            </Link>
          ))}
          <Link href="/pipeline?owner=none" className={`rounded-md px-2 py-1 ${owner === "none" ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>Unassigned</Link>
        </div>
      </div>
      <p className="text-xs text-slate-500">Change a stage on the lead page; logging activity moves leads forward automatically.</p>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {OPEN_STAGES.map((stage, i) => {
          const cards = (columns[i].data ?? []) as Card[];
          const n = total(stage);
          return (
            <section key={stage} className="w-64 shrink-0 rounded-xl bg-slate-100 p-2">
              <header className="mb-2 flex items-center justify-between px-1">
                <span className={`chip ${STAGE_COLOR[stage]}`}>{STAGE_LABEL[stage]}</span>
                <span className="text-xs text-slate-500">{n} · {minutes(mins(stage))}</span>
              </header>
              <ul className="space-y-2">
                {cards.map((c) => {
                  const o = c.owner_id ? byId.get(c.owner_id) : null;
                  return (
                    <li key={c.id}>
                      <Link href={`/leads/${c.id}`} className="block rounded-lg border border-slate-200 bg-white p-2 text-sm hover:border-slate-400"
                        style={{ borderLeft: `4px solid ${o?.color ?? "#cbd5e1"}` }}>
                        <div className="font-medium leading-tight">{c.name}</div>
                        <div className="text-xs text-slate-500">{[c.city, c.region].filter(Boolean).join(", ")}</div>
                        <div className="mt-1 flex justify-between text-xs text-slate-500">
                          <span>{o ? memberName(o) : "Unassigned"}</span>
                          <span>{ago(c.last_touch_at)} · {minutes(c.minutes_spent)}</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {n > cards.length && (
                <Link href={`/leads?stage=${stage}${owner ? `&owner=${owner}` : ""}`} className="mt-2 block text-center text-xs text-slate-600 hover:underline">
                  +{n - cards.length} more in Leads →
                </Link>
              )}
              {n === 0 && <p className="px-1 py-4 text-center text-xs text-slate-400">Empty</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
