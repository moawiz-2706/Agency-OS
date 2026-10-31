import Link from "next/link";
import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { teamMembers } from "@/lib/team";
import { OPEN_STAGES, memberColor, memberName, type Stage } from "@/lib/crm";
import { ago, minutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { StageBadge } from "@/components/stage-badge";
import { MemberAvatar } from "@/components/member-avatar";

export const metadata: Metadata = { title: "Pipeline" };

const PER_COLUMN = 40;

type CardRow = { id: string; name: string; city: string | null; region: string | null; owner_id: string | null;
  last_touch_at: string | null; minutes_spent: number; score: number | null };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const { owner } = await searchParams;
  const supabase = await supabaseServer();
  const team = await teamMembers();

  // One query per column keeps each one sorted and capped; totals come from the view.
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
  const total = (st: Stage) => countRows.filter((r) => r.stage === st).reduce((n, r) => n + r.leads, 0);
  const mins = (st: Stage) => countRows.filter((r) => r.stage === st).reduce((n, r) => n + r.minutes, 0);

  const filters = [
    { key: undefined, label: "Everyone", color: null },
    ...team.map((m) => ({ key: m.id, label: memberName(m), color: memberColor(team, m.id) })),
    { key: "none", label: "Unassigned", color: memberColor(team, null) },
  ];

  return (
    <>
      <PageHeader title="Pipeline" description="Open leads by stage. Change a stage on the lead page; logging activity moves leads forward.">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1 text-sm">
          {filters.map((f) => (
            <Link key={f.label} href={f.key ? `/pipeline?owner=${f.key}` : "/pipeline"}
              className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors",
                owner === f.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {f.color && <span className="size-2 rounded-full" style={{ background: f.color }} />}{f.label}
            </Link>
          ))}
        </div>
      </PageHeader>

      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {OPEN_STAGES.map((stage, i) => {
          const cards = (columns[i].data ?? []) as CardRow[];
          const n = total(stage);
          return (
            <section key={stage} className="flex w-72 shrink-0 snap-start flex-col rounded-xl border bg-muted/50">
              <header className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <StageBadge stage={stage} />
                  <span className="text-sm font-semibold tabular-nums">{n}</span>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" />{minutes(mins(stage))}</span>
              </header>
              <ul className="flex max-h-[calc(100vh-15rem)] flex-col gap-2 overflow-y-auto p-2">
                {cards.map((c) => (
                  <li key={c.id}>
                    <Link href={`/leads/${c.id}`}
                      className="block rounded-lg border border-l-4 bg-card p-3 text-sm shadow-xs transition hover:border-foreground/20 hover:shadow-sm"
                      style={{ borderLeftColor: memberColor(team, c.owner_id) }}>
                      <div className="font-medium leading-snug">{c.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{[c.city, c.region].filter(Boolean).join(", ") || "—"}</div>
                      <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
                        <MemberAvatar team={team} id={c.owner_id} size="sm" />
                        <span className="tabular-nums">{ago(c.last_touch_at)} · {minutes(c.minutes_spent)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
                {n === 0 && <li className="py-8 text-center text-xs text-muted-foreground">No leads</li>}
              </ul>
              {n > cards.length && (
                <Link href={`/leads?stage=${stage}${owner ? `&owner=${owner}` : ""}`}
                  className="border-t px-3 py-2 text-center text-xs font-medium text-muted-foreground hover:text-foreground">
                  View all {n.toLocaleString()} in Leads →
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
