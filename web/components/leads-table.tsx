"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Globe, Loader2, Mail, Phone } from "lucide-react";
import { bulkUpdate } from "@/app/(app)/leads/actions";
import { enrollCompanies } from "@/app/(app)/sequences/actions";
import { STAGE_LABEL, STAGES, memberName, type Member, type Stage } from "@/lib/crm";
import { ago, minutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StageBadge } from "@/components/stage-badge";
import { MemberLabel } from "@/components/member-avatar";
import { OFFER_TITLE, isOfferKey } from "@/lib/offers";

export type LeadRow = {
  id: string; name: string; trade: string | null; city: string | null; region: string | null; stage: Stage;
  owner_id: string | null; score: number | null; tier: string | null; email: string | null; phone: string | null;
  website_domain: string | null; last_touch_at: string | null; next_step: string | null; next_step_at: string | null;
  minutes_spent: number;
  recommended_offers: { key: string; reasons: string[] }[] | null;
};

const TIER_DOT: Record<string, string> = { high: "bg-emerald-500", medium: "bg-amber-500", low: "bg-zinc-300" };

export function LeadsTable({ rows, team, sequences = [] }: { rows: LeadRow[]; team: Member[]; sequences?: { id: string; name: string }[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [action, setAction] = useState("");
  const [pending, start] = useTransition();
  const all = rows.length > 0 && picked.size === rows.length;
  const some = picked.size > 0 && !all;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const apply = () => start(async () => {
    const f = new FormData();
    picked.forEach((id) => f.append("ids", id));
    f.set("bulk_action", action);
    const res = action.startsWith("sequence:") ? await enrollCompanies(action.slice(9), [...picked]) : await bulkUpdate(f);
    if (res.ok) {
      toast.success(res.message ?? `Updated ${picked.size} ${picked.size === 1 ? "lead" : "leads"}`, { duration: 10000 });
      setPicked(new Set());
      setAction("");
    } else toast.error(res.error);
  });

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className={cn("flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-sm transition-colors", picked.size && "bg-accent/50")}>
        <span className="min-w-20 text-muted-foreground">{picked.size ? `${picked.size} selected` : "Select leads for bulk changes"}</span>
        <Select value={action} onValueChange={setAction} disabled={!picked.size}>
          <SelectTrigger size="sm" className="w-48 bg-background"><SelectValue placeholder="Bulk action…" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Assign owner</SelectLabel>
              {team.map((m) => <SelectItem key={m.id} value={`owner:${m.id}`}>{memberName(m)}</SelectItem>)}
              <SelectItem value="owner:none">Unassigned</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Move to stage</SelectLabel>
              {STAGES.map((s) => <SelectItem key={s} value={`stage:${s}`}>{STAGE_LABEL[s]}</SelectItem>)}
            </SelectGroup>
            {sequences.length > 0 && <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Add to sequence</SelectLabel>
                {sequences.map((q) => <SelectItem key={q.id} value={`sequence:${q.id}`}>{q.name}</SelectItem>)}
              </SelectGroup>
            </>}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={apply} disabled={!picked.size || !action || pending}>
          {pending && <Loader2 className="animate-spin" />}Apply
        </Button>
        {picked.size > 0 && <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>}
      </div>

      <div className="overflow-x-auto">
        <Table className="min-w-[1080px]">
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-10 pl-4">
                <Checkbox checked={all ? true : some ? "indeterminate" : false} aria-label="Select all on this page"
                  onCheckedChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))} />
              </TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Top offer</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Last touch</TableHead>
              <TableHead>Next step</TableHead>
              <TableHead className="pr-4 text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const overdue = r.next_step_at && new Date(r.next_step_at) < new Date();
              return (
                <TableRow key={r.id} data-state={picked.has(r.id) ? "selected" : undefined}>
                  <TableCell className="pl-4">
                    <Checkbox checked={picked.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
                  </TableCell>
                  <TableCell className="max-w-72">
                    <Link href={`/leads/${r.id}`} className="block truncate font-medium hover:underline">{r.name}</Link>
                    <div className="truncate text-xs text-muted-foreground">{[r.trade, r.city, r.region].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell><StageBadge stage={r.stage} /></TableCell>
                  <TableCell className="whitespace-nowrap"><MemberLabel team={team} id={r.owner_id} /></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.score != null ? (
                      <span className="inline-flex items-center gap-1.5" title={r.tier ? `${r.tier} tier` : undefined}>
                        <span className={cn("size-1.5 rounded-full", TIER_DOT[r.tier ?? ""] ?? "bg-zinc-300")} />{r.score}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="max-w-44">
                    {(() => {
                      const top = r.recommended_offers?.[0];
                      return top && isOfferKey(top.key)
                        ? <span className="block truncate text-xs" title={top.reasons.join(" · ")}>{OFFER_TITLE[top.key]}</span>
                        : <span className="text-xs text-muted-foreground">—</span>;
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className={cn("size-3.5", r.email ? "text-foreground" : "opacity-30")} aria-label={r.email ? `Email ${r.email}` : "No email"} />
                      <Phone className={cn("size-3.5", r.phone ? "text-foreground" : "opacity-30")} aria-label={r.phone ? `Phone ${r.phone}` : "No phone"} />
                      <Globe className={cn("size-3.5", r.website_domain ? "text-foreground" : "opacity-30")} aria-label={r.website_domain ?? "No website"} />
                      <span className="ml-1 max-w-40 truncate text-xs">{r.email ?? r.phone ?? ""}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{ago(r.last_touch_at)}</TableCell>
                  <TableCell className="max-w-48 text-xs">
                    <div className="truncate">{r.next_step ?? ""}</div>
                    {r.next_step_at && <div className={overdue ? "font-medium text-destructive" : "text-muted-foreground"}>{ago(r.next_step_at)}</div>}
                  </TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{minutes(r.minutes_spent)}</TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={10} className="py-12 text-center text-muted-foreground">No leads match these filters.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
