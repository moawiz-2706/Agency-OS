import Link from "next/link";
import type { Metadata } from "next";
import { ListOrdered, Plus } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { createSequence } from "./actions";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Sequences" };
export const dynamic = "force-dynamic";

type Row = { id: string; name: string; description: string | null; status: string; template_ids: string[]; step_days: number[] };
type Summary = { campaign_id: string; leads: number; needs_approval: number; scheduled: number; sent: number; replied: number; stopped: number };

export default async function SequencesPage() {
  const supabase = await supabaseServer();
  const [{ data, error }, { data: sums }] = await Promise.all([
    supabase.from("campaigns").select("id,name,description,status,template_ids,step_days").order("created_at", { ascending: false }),
    supabase.rpc("sequence_summary"),
  ]);
  const rows = (data ?? []) as Row[];
  const by = new Map(((sums ?? []) as Summary[]).map((s) => [s.campaign_id, s]));

  return (
    <>
      <PageHeader title="Sequences" description="Write a follow-up series once; add leads and every email is drafted for approval, in each lead's time zone." />

      {error && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        Sequences need migration 0010: run it in Supabase (SQL Editor), then reload. ({error.message})</p>}

      <Card>
        <CardHeader><CardTitle>New sequence</CardTitle><CardDescription>It starts with three example steps for the &quot;Never miss a lead&quot; offer. Edit them next.</CardDescription></CardHeader>
        <CardContent>
          <form action={createSequence} className="flex flex-wrap gap-2">
            <Input name="name" placeholder="e.g. GHL users · Texas HVAC" required className="min-w-56 flex-1" />
            <Input name="description" placeholder="Who it's for (optional)" className="min-w-56 flex-1" />
            <SubmitButton><Plus />Create</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 && !error ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground"><ListOrdered className="mx-auto mb-2 size-8" />No sequences yet.</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => {
            const s = by.get(r.id);
            return (
              <Link key={r.id} href={`/sequences/${r.id}`} className="block">
                <Card className="h-full transition-colors hover:bg-accent/40">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <CardTitle className="min-w-0 flex-1 truncate">{r.name}</CardTitle>
                      <Badge variant="outline" className={r.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : ""}>
                        {r.status === "active" ? "Active" : r.status === "paused" ? "Paused" : "Draft"}
                      </Badge>
                    </div>
                    <CardDescription>
                      {r.template_ids.length} steps · days {r.step_days.slice(0, r.template_ids.length).join(", ")}{r.description ? ` · ${r.description}` : ""}
                    </CardDescription>
                  </CardHeader>
                  {s && (
                    <CardContent className="grid grid-cols-5 gap-2 text-center text-xs text-muted-foreground">
                      {([["Leads", s.leads], ["To approve", s.needs_approval], ["Scheduled", s.scheduled], ["Sent", s.sent], ["Replied", s.replied]] as const).map(([k, v]) => (
                        <div key={k}><div className="text-lg font-semibold text-foreground">{v}</div>{k}</div>
                      ))}
                    </CardContent>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
