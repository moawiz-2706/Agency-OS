import Link from "next/link";
import type { Metadata } from "next";
import {
  AlarmClock, ArrowDownRight, ArrowUpRight, CalendarCheck, Clock, Handshake, MessageSquareReply, Minus, Send, Sparkles,
  Trophy, Users,
} from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { teamMembers } from "@/lib/team";
import {
  CHANNEL_LABEL, OUTCOME_LABEL, OUTREACH, PALETTE, POSITIVE, STAGE_LABEL, STAGES, memberColor, memberName,
  type Channel, type Outcome, type Stage,
} from "@/lib/crm";
import { TEAM_TZ, ago, dayLabel, minutes, teamDay } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { MemberAvatar, MemberLabel } from "@/components/member-avatar";
import { TimeTrendChart, type TrendPoint } from "@/components/charts/time-trend";
import { BarList } from "@/components/charts/bar-list";
import { RangeTabs } from "@/components/range-tabs";

export const metadata: Metadata = { title: "Dashboard" };

type Touch = {
  id: string; company_id: string; member_id: string | null; channel: Channel; outcome: Outcome;
  minutes: number; summary: string | null; happened_at: string; companies: { name: string } | null;
};

const RANGES = [7, 30, 90] as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const asked = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 7;
  const now = Date.now();
  const since = new Date(now - days * 86400_000).toISOString();
  const prevSince = new Date(now - 2 * days * 86400_000).toISOString();
  const supabase = await supabaseServer();

  const [team, touchesRes, leadsRes, stageRes, overdueRes, latestRes] = await Promise.all([
    teamMembers(),
    supabase.from("touches").select("id,company_id,member_id,channel,outcome,minutes,summary,happened_at,companies(name)")
      .gte("happened_at", prevSince).order("happened_at", { ascending: false }).limit(10000),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase.from("v_stage_counts").select("stage,owner_id,leads,minutes"),
    supabase.from("companies").select("id,name,next_step,next_step_at,owner_id")
      .lt("next_step_at", new Date(now).toISOString()).not("stage", "in", "(won,lost,disqualified)")
      .order("next_step_at").limit(8),
    supabase.from("touches").select("id,company_id,member_id,channel,outcome,minutes,summary,happened_at,companies(name)")
      .order("happened_at", { ascending: false }).limit(8),
  ]);

  const all = (touchesRes.data ?? []) as unknown as Touch[];
  const cur = all.filter((t) => t.happened_at >= since);
  const prev = all.filter((t) => t.happened_at < since);
  const stageRows = (stageRes.data ?? []) as { stage: Stage; owner_id: string | null; leads: number; minutes: number }[];

  // ---- KPIs, each against the period before ----
  const leadsWith = (ts: Touch[], pred: (t: Touch) => boolean) => new Set(ts.filter(pred).map((t) => t.company_id)).size;
  const metric = (pred: (t: Touch) => boolean) => ({ cur: leadsWith(cur, pred), prev: leadsWith(prev, pred) });
  const sumMin = (ts: Touch[]) => ts.reduce((n, t) => n + t.minutes, 0);
  const kpis = [
    { label: "Contacted", icon: Send, ...metric((t) => OUTREACH.includes(t.channel)), fmt: String },
    { label: "Replied", icon: MessageSquareReply, ...metric((t) => t.outcome === "replied"), fmt: String },
    { label: "Interested", icon: Sparkles, ...metric((t) => t.outcome === "interested"), fmt: String },
    { label: "Meetings", icon: CalendarCheck, ...metric((t) => t.outcome === "meeting_booked"), fmt: String },
    { label: "Won", icon: Trophy, ...metric((t) => t.outcome === "won"), fmt: String },
    { label: "Time spent", icon: Clock, cur: sumMin(cur), prev: sumMin(prev), fmt: minutes },
    { label: "Touches", icon: Handshake, cur: cur.length, prev: prev.length, fmt: String },
  ];

  // ---- time per day, stacked by member ----
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) dayKeys.push(teamDay(new Date(now - i * 86400_000)));
  const memberKeys = [...team.map((m) => m.id), ...(cur.some((t) => !t.member_id) ? ["none"] : [])];
  const trend: TrendPoint[] = dayKeys.map((d) => ({ label: dayLabel(d), ...Object.fromEntries(memberKeys.map((k) => [k, 0])) }));
  const dayIndex = new Map(dayKeys.map((d, i) => [d, i]));
  for (const t of cur) {
    const i = dayIndex.get(teamDay(t.happened_at));
    if (i === undefined) continue;
    const k = t.member_id ?? "none";
    trend[i][k] = (Number(trend[i][k]) || 0) + t.minutes;
  }
  const series = memberKeys.map((k) => ({
    key: k, name: k === "none" ? "Unknown" : memberName(team.find((m) => m.id === k)), color: k === "none" ? "#a8a29e" : memberColor(team, k),
  }));

  // ---- per member table ----
  const owned = new Map<string, number>();
  for (const r of stageRows) if (r.owner_id) owned.set(r.owner_id, (owned.get(r.owner_id) ?? 0) + r.leads);
  const perMember = team.map((m) => {
    const mine = cur.filter((t) => t.member_id === m.id);
    return {
      id: m.id, minutes: sumMin(mine), touches: mine.length, owned: owned.get(m.id) ?? 0,
      contacted: leadsWith(mine, (t) => OUTREACH.includes(t.channel)),
      positive: mine.filter((t) => POSITIVE.includes(t.outcome)).length,
      meetings: mine.filter((t) => t.outcome === "meeting_booked").length,
    };
  });
  const teamMinutes = Math.max(1, sumMin(cur));

  // ---- time by activity ----
  const byChannel = Object.entries(cur.reduce<Record<string, { n: number; m: number }>>((acc, t) => {
    acc[t.channel] ??= { n: 0, m: 0 };
    acc[t.channel].n++; acc[t.channel].m += t.minutes;
    return acc;
  }, {})).sort((a, b) => b[1].m - a[1].m);

  // ---- pipeline now ----
  const pipeline = STAGES.map((s) => {
    const rows = stageRows.filter((r) => r.stage === s);
    return { stage: s, leads: rows.reduce((n, r) => n + r.leads, 0), minutes: rows.reduce((n, r) => n + r.minutes, 0) };
  }).filter((p) => p.leads > 0);

  const overdue = overdueRes.data ?? [];
  const latest = (latestRes.data ?? []) as unknown as Touch[];

  return (
    <>
      <PageHeader title="Dashboard" description={`${(leadsRes.count ?? 0).toLocaleString()} leads · times in ${TEAM_TZ}`}>
        <RangeTabs days={days} options={[...RANGES]} />
      </PageHeader>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {kpis.map((k) => {
          const diff = k.cur - k.prev;
          const Trend = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
          return (
            <Card key={k.label} className="gap-0 py-4">
              <CardContent className="px-4">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  {k.label}<k.icon className="size-3.5" />
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{k.fmt(k.cur)}</div>
                <div className="mt-1 flex items-center gap-0.5 text-[11px] text-muted-foreground">
                  <Trend className="size-3" />
                  {diff === 0 ? "same as" : `${diff > 0 ? "+" : "−"}${k.fmt(Math.abs(diff))} vs`} previous {days}d
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Where our time goes</CardTitle>
          <CardDescription>Minutes logged per day, by team member</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <TimeTrendChart data={trend} series={series} />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead className="text-right">Touches</TableHead>
                  <TableHead className="text-right">Leads owned</TableHead>
                  <TableHead className="text-right">Contacted</TableHead>
                  <TableHead className="text-right">Positive</TableHead>
                  <TableHead className="text-right">Meetings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perMember.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><MemberLabel team={team} id={r.id} /></TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{minutes(r.minutes)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{Math.round((r.minutes / teamMinutes) * 100)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{r.touches}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.owned}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.contacted}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.positive}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.meetings}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Time by activity</CardTitle>
            <CardDescription>Last {days} days</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList color={PALETTE[0]} empty="No activity logged in this period."
              items={byChannel.map(([ch, v]) => ({
                key: ch, label: CHANNEL_LABEL[ch as Channel], value: v.m, display: minutes(v.m),
                detail: `${v.n} ${v.n === 1 ? "touch" : "touches"} · avg ${minutes(Math.round(v.m / v.n))}`,
              }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
            <CardDescription>Leads in each stage now</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList color={PALETTE[0]} empty="No leads yet."
              items={pipeline.map((p) => ({
                key: p.stage, label: STAGE_LABEL[p.stage], value: p.leads, display: p.leads.toLocaleString(),
                detail: `${minutes(p.minutes)} spent on these leads`, href: `/leads?stage=${p.stage}`,
              }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlarmClock className="size-4" />Overdue next steps</CardTitle>
          </CardHeader>
          <CardContent>
            {overdue.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing overdue. Nice.</p>
            ) : (
              <ul className="divide-y">
                {overdue.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <MemberAvatar team={team} id={c.owner_id} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/leads/${c.id}`} className="block truncate text-sm font-medium hover:underline">{c.name}</Link>
                      <div className="truncate text-xs text-muted-foreground">{c.next_step || "Follow up"}</div>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-destructive">due {ago(c.next_step_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="size-4" />Latest activity</CardTitle>
          </CardHeader>
          <CardContent>
            {latest.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No activity yet. Open a lead and log what you did.</p>
            ) : (
              <ul className="divide-y">
                {latest.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 py-2.5">
                    <MemberAvatar team={team} id={t.member_id} />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate">
                        <span className="font-medium">{memberName(team.find((m) => m.id === t.member_id))}</span>
                        <span className="text-muted-foreground"> · {CHANNEL_LABEL[t.channel]} · {OUTCOME_LABEL[t.outcome]} · </span>
                        <Link href={`/leads/${t.company_id}`} className="hover:underline">{t.companies?.name}</Link>
                      </div>
                      {t.summary && <div className="truncate text-xs text-muted-foreground">{t.summary}</div>}
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className="font-medium tabular-nums">{minutes(t.minutes)}</div>
                      <div className="text-muted-foreground">{ago(t.happened_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
