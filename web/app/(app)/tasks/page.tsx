import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember, teamMembers } from "@/lib/team";
import { memberName } from "@/lib/crm";
import { isoToTeamLocal } from "@/lib/format";
import { bucket, dueLabel, toTaskItem, type TaskRowData } from "@/lib/tasks";
import { addTask } from "./actions";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { TaskRow, type TaskItem } from "@/components/tasks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { key: "overdue", title: "Overdue" },
  { key: "today", title: "Today" },
  { key: "upcoming", title: "Coming up" },
  { key: "someday", title: "No date" },
] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ who?: string; done?: string }> }) {
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const [{ member: me }, team] = await Promise.all([currentMember(), teamMembers()]);
  const who = sp.who === "all" ? "all" : "me";
  const now = new Date();

  let tasksQ = supabase.from("tasks").select("id,title,due_at,done_at,company_id,assignee_id,companies(name)").is("done_at", null)
    .order("due_at", { ascending: true, nullsFirst: false }).limit(500);
  let stepsQ = supabase.from("companies").select("id,name,next_step,next_step_at,owner_id").not("next_step_at", "is", null)
    .lt("next_step_at", new Date(now.getTime() + 7 * 86400_000).toISOString()).not("stage", "in", "(won,lost,disqualified)")
    .order("next_step_at").limit(200);
  if (who === "me" && me) {
    tasksQ = tasksQ.eq("assignee_id", me.id);
    stepsQ = stepsQ.eq("owner_id", me.id);
  }
  const [tasksRes, stepsRes, doneRes] = await Promise.all([
    tasksQ, stepsQ,
    supabase.from("tasks").select("id,title,due_at,done_at,company_id,assignee_id,companies(name)").not("done_at", "is", null)
      .gte("done_at", new Date(now.getTime() - 7 * 86400_000).toISOString()).order("done_at", { ascending: false }).limit(30),
  ]);
  const missing = tasksRes.error && /tasks/.test(tasksRes.error.message);

  // Tasks, plus leads whose "next step" is due within a week (set on the lead's Status card).
  const items: TaskItem[] = [
    ...((tasksRes.data ?? []) as unknown as TaskRowData[]).map((t) => toTaskItem(t, team, now)),
    ...((stepsRes.data ?? []) as { id: string; name: string; next_step: string | null; next_step_at: string; owner_id: string | null }[]).map((c) => ({
      id: `step-${c.id}`, title: c.next_step || "Follow up", due_at: c.next_step_at, done_at: null, company_id: c.id, company: c.name,
      assignee: c.owner_id ? memberName(team.find((m) => m.id === c.owner_id)) : null,
      overdue: bucket(c.next_step_at, now) === "overdue", dueLabel: dueLabel(c.next_step_at, now), nextStep: true,
    })),
  ].sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
  const done = ((doneRes.data ?? []) as unknown as TaskRowData[]).map((t) => toTaskItem(t, team, now));

  return (
    <>
      <PageHeader title="Tasks" description="What needs doing: your tasks and leads' next steps, in Pakistan time.">
        <div className="flex gap-1 rounded-lg border bg-card p-1">
          <Button asChild size="sm" variant={who === "me" ? "secondary" : "ghost"}><Link href="/tasks">Mine</Link></Button>
          <Button asChild size="sm" variant={who === "all" ? "secondary" : "ghost"}><Link href="/tasks?who=all">Everyone</Link></Button>
        </div>
      </PageHeader>

      {missing && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        Tasks need migration 0012: run it in Supabase (SQL Editor), then reload.</p>}

      <Card>
        <CardContent>
          <ActionForm action={addTask.bind(null, null)} reset className="flex flex-wrap gap-2">
            <Input name="title" placeholder="Add a task, e.g. Send proposal template to Abdullah" required className="min-w-60 flex-[2]" />
            <Input name="due_at" type="datetime-local" defaultValue={isoToTeamLocal(new Date(now.getTime() + 3600_000).toISOString())} className="w-auto flex-1" />
            <Select name="assignee_id" defaultValue="me">
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">For me</SelectItem>
                {team.filter((m) => m.id !== me?.id).map((m) => <SelectItem key={m.id} value={m.id}>For {memberName(m)}</SelectItem>)}
              </SelectContent>
            </Select>
            <SubmitButton><Plus />Add</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-muted-foreground">Tasks about a lead are added on the lead&apos;s page.</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {SECTIONS.map(({ key, title }) => {
          const list = items.filter((t) => bucket(t.due_at, now) === key);
          if (!list.length && key !== "today") return null;
          return (
            <Card key={key} className="gap-2">
              <CardHeader><CardTitle className={key === "overdue" ? "text-red-600 dark:text-red-400" : ""}>{title} ({list.length})</CardTitle></CardHeader>
              <CardContent>
                {list.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nothing due today.</p> : (
                  <ul className="divide-y">{list.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
                )}
              </CardContent>
            </Card>
          );
        })}
        {done.length > 0 && (
          <Card className="gap-2">
            <CardHeader><CardTitle className="text-muted-foreground">Done this week ({done.length})</CardTitle></CardHeader>
            <CardContent><ul className="divide-y">{done.map((t) => <TaskRow key={t.id} t={t} />)}</ul></CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
