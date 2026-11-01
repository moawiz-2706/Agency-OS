import { CheckSquare, Handshake, Plus } from "lucide-react";
import { saveDeal } from "@/app/(app)/leads/actions";
import { addTask } from "@/app/(app)/tasks/actions";
import { memberName, type Member } from "@/lib/crm";
import { TEAM_TZ, money } from "@/lib/format";
import { OFFER_KEYS, OFFER_TITLE } from "@/lib/offers";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { TaskRow, type TaskItem } from "@/components/tasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Deal = {
  offer: string | null; currency: string; setup_fee_cents: number | null; monthly_fee_cents: number | null; stage: string;
  probability: number | null; expected_close: string | null; notes: string | null;
};

const DEAL_STAGES = [["open", "Talking"], ["proposal_sent", "Proposal sent"], ["won", "Won"], ["lost", "Lost"]] as const;
const amount = (c: number | null) => (c != null ? String(c / 100) : "");

/** What we're selling this lead: offer, one-off setup and monthly fee. */
export function DealCard({ companyId, deal, suggestedOffer }: { companyId: string; deal: Deal | null; suggestedOffer: string | null }) {
  const cur = deal?.currency ?? "USD";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Handshake className="size-4" />Deal</CardTitle>
        {deal && (deal.setup_fee_cents || deal.monthly_fee_cents) ? (
          <CardDescription>
            {money(deal.setup_fee_cents ?? 0, cur)} setup + {money(deal.monthly_fee_cents ?? 0, cur)}/month
            {deal.probability != null && deal.stage !== "won" && deal.stage !== "lost" ? ` · ${Math.round(deal.probability * 100)}% likely` : ""}
          </CardDescription>
        ) : <CardDescription>Set the offer and price once you&apos;re talking.</CardDescription>}
      </CardHeader>
      <CardContent>
        <ActionForm action={saveDeal.bind(null, companyId)} success="Deal saved" className="grid gap-3">
          <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">Offer</Label>
            <Select name="offer" defaultValue={deal?.offer ?? suggestedOffer ?? undefined}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Pick the offer" /></SelectTrigger>
              <SelectContent>{OFFER_KEYS.map((k) => <SelectItem key={k} value={k}>{OFFER_TITLE[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[1fr_1fr_5.5rem] gap-2">
            <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">Setup fee</Label><Input name="setup_fee" inputMode="decimal" defaultValue={amount(deal?.setup_fee_cents ?? null)} placeholder="997" /></div>
            <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">Monthly</Label><Input name="monthly_fee" inputMode="decimal" defaultValue={amount(deal?.monthly_fee_cents ?? null)} placeholder="297" /></div>
            <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">Currency</Label>
              <Select name="currency" defaultValue={cur}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CAD">CAD</SelectItem></SelectContent></Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">Deal stage</Label>
              <Select name="deal_stage" defaultValue={deal?.stage ?? "open"}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{DEAL_STAGES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">Chance to close (%)</Label><Input name="probability" type="number" min={0} max={100} defaultValue={deal?.probability != null ? Math.round(deal.probability * 100) : ""} /></div>
          </div>
          <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">Expected close</Label><Input name="expected_close" type="date" defaultValue={deal?.expected_close ?? ""} /></div>
          <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">Notes</Label><Input name="notes" defaultValue={deal?.notes ?? ""} placeholder="e.g. wants it live before spring" /></div>
          <p className="text-xs text-muted-foreground">Proposal sent, Won or Lost here moves the lead to that stage too.</p>
          <SubmitButton className="w-full">Save deal</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}

/** The lead's open tasks and a quick add. */
export function LeadTasksCard({ companyId, tasks, team, meId, defaultDue }: { companyId: string; tasks: TaskItem[]; team: Member[]; meId: string | null; defaultDue: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CheckSquare className="size-4" />Tasks</CardTitle>
        <CardDescription>Times in {TEAM_TZ.replace(/_/g, " ")}. All tasks are on the Tasks page.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.length > 0 && <ul className="divide-y">{tasks.map((t) => <TaskRow key={t.id} t={t} showLead={false} />)}</ul>}
        <ActionForm action={addTask.bind(null, companyId)} reset className="grid gap-2">
          <Input name="title" placeholder="e.g. Call Darin back" required />
          <div className="grid grid-cols-[1fr_8rem] gap-2">
            <Input name="due_at" type="datetime-local" defaultValue={defaultDue} />
            <Select name="assignee_id" defaultValue="me">
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Me</SelectItem>
                {team.filter((m) => m.id !== meId).map((m) => <SelectItem key={m.id} value={m.id}>{memberName(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <SubmitButton size="sm" variant="outline"><Plus />Add task</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
