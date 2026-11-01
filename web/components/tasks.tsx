"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { clearNextStep, deleteTask, setTaskDone } from "@/app/(app)/tasks/actions";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TaskItem = {
  id: string; title: string; due_at: string | null; done_at: string | null; company_id: string | null;
  company: string | null; assignee: string | null; overdue: boolean; dueLabel: string;
  /** A lead's "next step" shown as a task: ticking it clears the next step. */
  nextStep?: boolean;
};

/** One task: tick to finish (or untick), delete, link to its lead. */
export function TaskRow({ t, showLead = true }: { t: TaskItem; showLead?: boolean }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const res = await fn();
    if (!res.ok) toast.error(res.error ?? "Something went wrong");
    else if (res.message) toast.success(res.message);
  });
  const done = !!t.done_at;
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      {pending ? <Loader2 className="mt-0.5 size-4 animate-spin text-muted-foreground" /> : (
        <Checkbox className="mt-0.5" checked={done} aria-label={done ? "Mark not done" : "Mark done"}
          onCheckedChange={(v) => run(() => (t.nextStep ? clearNextStep(t.company_id!) : setTaskDone(t.id, t.company_id, v === true)))} />
      )}
      <div className="min-w-0 flex-1">
        <div className={cn("break-words", done && "text-muted-foreground line-through")}>
          {t.nextStep && <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Next step</span>}
          {t.title}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {showLead && t.company_id && <Link href={`/leads/${t.company_id}`} className="font-medium text-foreground/80 hover:underline">{t.company ?? "Lead"}</Link>}
          {t.dueLabel && <span className={cn(t.overdue && !done && "font-medium text-red-600 dark:text-red-400")}>{t.dueLabel}</span>}
          {t.assignee && <span>· {t.assignee}</span>}
        </div>
      </div>
      {!t.nextStep && (
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" aria-label="Delete task" disabled={pending}
          onClick={() => run(() => deleteTask(t.id, t.company_id))}><Trash2 className="size-3.5" /></Button>
      )}
    </li>
  );
}
