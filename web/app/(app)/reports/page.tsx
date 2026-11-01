import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { TEAM_TZ, money } from "@/lib/format";
import {
  FUNNEL_LABEL, FUNNEL_STEPS, bounceAlarm, deliverability, funnel, pct, type FunnelLead, type FunnelRow,
} from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const DAYS = 14;
type Deal = { stage: string; currency: string; setup_fee_cents: number | null; monthly_fee_cents: number | null; probability: number | null };

function FunnelTable({ title, rows }: { title: string; rows: FunnelRow[] }) {
  return (
    <Card className="gap-2">
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>Most contacted first. Reply rate = replied ÷ contacted.</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="pl-6"> </TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Contacted</TableHead>
            <TableHead className="text-right">Replied</TableHead><TableHead className="text-right">Reply rate</TableHead>
            <TableHead className="text-right">Interested</TableHead><TableHead className="pr-6 text-right">Won</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.slice(0, 15).map((r) => (
              <TableRow key={r.key}>
                <TableCell className="max-w-48 truncate pl-6 font-medium">{r.key}</TableCell>
                <TableCell className="text-right tabular-nums">{r.counts.leads}</TableCell>
                <TableCell className="text-right tabular-nums">{r.counts.contacted}</TableCell>
                <TableCell className="text-right tabular-nums">{r.counts.replied}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(r.counts.replied, r.counts.contacted)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.counts.interested}</TableCell>
                <TableCell className="pr-6 text-right tabular-nums">{r.counts.won}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default async function ReportsPage() {
  const supabase = await supabaseServer();
  const since = new Date(new Date().getTime() - DAYS * 86400_000).toISOString();

  // Every lead (in pages: the API returns at most 1,000 rows at a time).
  const leads: FunnelLead[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data } = await supabase.from("companies").select("id,stage,trade,region,source,touches_count").order("id").range(from, from + 999);
    leads.push(...((data ?? []) as FunnelLead[]));
    if (!data || data.length < 1000) break;
  }
  const [repliedRes, sentRes, bounceRes, replyRes, unsubRes, inboxesRes, dealsRes] = await Promise.all([
    supabase.from("inbound_messages").select("company_id").not("company_id", "is", null)
      .or("classification.is.null,classification.not.in.(bounce,out_of_office)").limit(10_000),
    supabase.from("outreach_messages").select("sent_at,mail_account_id").eq("status", "sent").gte("sent_at", since).limit(10_000),
    supabase.from("inbound_messages").select("received_at,mail_account_id").eq("classification", "bounce").gte("received_at", since).limit(5000),
    supabase.from("inbound_messages").select("received_at,mail_account_id").or("classification.is.null,classification.not.in.(bounce,out_of_office)")
      .gte("received_at", since).limit(5000),
    supabase.from("suppressions").select("created_at").in("reason", ["unsubscribed", "asked_not_to"]).gte("created_at", since).limit(5000),
    supabase.rpc("team_inboxes"),
    supabase.from("deals").select("stage,currency,setup_fee_cents,monthly_fee_cents,probability"),   // missing until migration 0012
  ]);
  const repliedIds = new Set(((repliedRes.data ?? []) as { company_id: string }[]).map((r) => r.company_id));
  const sent = (sentRes.data ?? []) as { sent_at: string; mail_account_id: string | null }[];
  const bounces = (bounceRes.data ?? []) as { received_at: string; mail_account_id: string | null }[];
  const replies = (replyRes.data ?? []) as { received_at: string; mail_account_id: string | null }[];
  const unsubs = (unsubRes.data ?? []) as { created_at: string }[];
  const inboxes = (inboxesRes.data ?? []) as { id: string; email: string }[];
  const deals = (dealsRes.data ?? []) as Deal[];

  const [all] = funnel(leads, repliedIds);
  const counts = all?.counts ?? { leads: 0, contacted: 0, replied: 0, interested: 0, meeting: 0, won: 0 };
  const days = deliverability({
    sent: sent.map((s) => s.sent_at), bounced: bounces.map((b) => b.received_at),
    replies: replies.map((r) => r.received_at), unsubscribed: unsubs.map((u) => u.created_at),
  }, DAYS, TEAM_TZ);
  const perInbox = inboxes.map((i) => {
    const s = sent.filter((x) => x.mail_account_id === i.id).length;
    const b = bounces.filter((x) => x.mail_account_id === i.id).length;
    return { email: i.email, sent: s, bounced: b, replies: replies.filter((x) => x.mail_account_id === i.id).length };
  });

  // Deals by currency: open pipeline (setup + monthly, and weighted by chance), and what's won.
  const currencies = [...new Set(deals.map((d) => d.currency))];
  const money_ = currencies.map((cur) => {
    const of = deals.filter((d) => d.currency === cur);
    const open = of.filter((d) => d.stage === "open" || d.stage === "proposal_sent");
    const won = of.filter((d) => d.stage === "won");
    const sum = (list: Deal[], k: "setup_fee_cents" | "monthly_fee_cents", weighted = false) =>
      list.reduce((t, d) => t + (d[k] ?? 0) * (weighted ? d.probability ?? 0.5 : 1), 0);
    return {
      cur, open: open.length, openSetup: sum(open, "setup_fee_cents"), openMonthly: sum(open, "monthly_fee_cents"),
      weightedMonthly: sum(open, "monthly_fee_cents", true), won: won.length, wonSetup: sum(won, "setup_fee_cents"), wonMonthly: sum(won, "monthly_fee_cents"),
    };
  });

  const tiles = [
    ["Leads", String(counts.leads)],
    ["Contacted", `${counts.contacted}`],
    ["Reply rate", pct(counts.replied, counts.contacted)],
    ["Meetings", String(counts.meeting)],
    ["Won", String(counts.won)],
  ] as const;

  return (
    <>
      <PageHeader title="Reports" description={`Where leads drop off, and how your email is landing (last ${DAYS} days, Pakistan time).`} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([k, v]) => (
          <Card key={k} className="py-4"><CardContent className="px-4"><div className="text-2xl font-semibold tabular-nums">{v}</div><div className="text-xs text-muted-foreground">{k}</div></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Funnel</CardTitle>
          <CardDescription>How far every lead has got. The percentage is of the step before. Lost and nurture leads count up to where they reached.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2.5" aria-label="Funnel">
            {FUNNEL_STEPS.map((s, i) => {
              const n = counts[s];
              const prev = i ? counts[FUNNEL_STEPS[i - 1]] : null;
              const width = counts.leads ? Math.max(n ? 1.5 : 0, (n / counts.leads) * 100) : 0;
              return (
                <li key={s} className="grid grid-cols-[7.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 text-sm"
                  title={`${FUNNEL_LABEL[s]}: ${n} of ${counts.leads} leads${prev != null ? ` (${pct(n, prev)} of ${FUNNEL_LABEL[FUNNEL_STEPS[i - 1]].toLowerCase()})` : ""}`}>
                  <span className="text-muted-foreground">{FUNNEL_LABEL[s]}</span>
                  <span className="h-5 rounded-r-[4px] bg-muted/50">
                    <span className="block h-full rounded-r-[4px] bg-primary/80 transition-[width]" style={{ width: `${width}%` }} />
                  </span>
                  <span className="text-right tabular-nums"><span className="font-medium">{n}</span>{prev != null && <span className="ml-1.5 text-xs text-muted-foreground">{pct(n, prev)}</span>}</span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <FunnelTable title="By trade" rows={funnel(leads, repliedIds, (l) => l.trade)} />
        <FunnelTable title="By state / province" rows={funnel(leads, repliedIds, (l) => l.region)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="gap-2">
          <CardHeader>
            <CardTitle>Deliverability by inbox</CardTitle>
            <CardDescription>Last {DAYS} days. Over 3% bounces hurts every future email from that domain; sending pauses itself if it happens in a day.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="pl-6">Inbox</TableHead><TableHead className="text-right">Sent</TableHead><TableHead className="text-right">Bounced</TableHead>
                <TableHead className="text-right">Replies</TableHead><TableHead className="pr-6">Health</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {perInbox.map((i) => {
                  const bad = bounceAlarm(i.sent, i.bounced);
                  return (
                    <TableRow key={i.email}>
                      <TableCell className="max-w-56 truncate pl-6 font-medium">{i.email}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.sent}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.bounced} <span className="text-xs text-muted-foreground">{pct(i.bounced, i.sent)}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{i.replies}</TableCell>
                      <TableCell className="pr-6">
                        {bad
                          ? <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400"><AlertTriangle className="size-3.5" />Too many bounces</span>
                          : <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3.5" />OK</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {perInbox.length === 0 && <TableRow><TableCell colSpan={5} className="pl-6 text-muted-foreground">No inboxes connected.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader><CardTitle>Day by day</CardTitle><CardDescription>All inboxes. Unsubscribed includes &quot;no&quot; replies and unsubscribe links.</CardDescription></CardHeader>
          <CardContent className="max-h-[26rem] overflow-auto px-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="pl-6">Day</TableHead><TableHead className="text-right">Sent</TableHead><TableHead className="text-right">Bounced</TableHead>
                <TableHead className="text-right">Replies</TableHead><TableHead className="pr-6 text-right">Unsubscribed</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {days.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell className="pl-6">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.sent}</TableCell>
                    <TableCell className={`text-right tabular-nums ${bounceAlarm(d.sent, d.bounced) ? "font-medium text-red-600 dark:text-red-400" : ""}`}>{d.bounced}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.replies}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">{d.unsubscribed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Pipeline money</CardTitle>
          <CardDescription>From the Deal card on each lead. &quot;Likely&quot; weights each open deal by its chance to close (50% when not set).</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          {money_.length === 0 ? <p className="px-6 text-sm text-muted-foreground">No deals yet: add one from a lead&apos;s Deal card.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="pl-6">Currency</TableHead><TableHead className="text-right">Open deals</TableHead><TableHead className="text-right">Open setup</TableHead>
                <TableHead className="text-right">Open monthly</TableHead><TableHead className="text-right">Likely monthly</TableHead>
                <TableHead className="text-right">Won</TableHead><TableHead className="pr-6 text-right">Won monthly (MRR)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {money_.map((m) => (
                  <TableRow key={m.cur}>
                    <TableCell className="pl-6 font-medium">{m.cur}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.open}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(m.openSetup, m.cur)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(m.openMonthly, m.cur)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Math.round(m.weightedMonthly), m.cur)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.won} · {money(m.wonSetup, m.cur)} setup</TableCell>
                    <TableCell className="pr-6 text-right font-medium tabular-nums">{money(m.wonMonthly, m.cur)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
