import { TEAM_TZ } from "@/lib/format";
import { memberName, type Member } from "@/lib/crm";
import type { TaskItem } from "@/components/tasks";

export type TaskRowData = {
  id: string; title: string; due_at: string | null; done_at: string | null; company_id: string | null; assignee_id: string | null;
  companies: { name: string } | null;
};

const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TZ }).format(d);

/** "Today 14:00", "Tomorrow", "3 Nov", "Overdue · 1 Nov" in the team's time zone. */
export function dueLabel(iso: string | null, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TEAM_TZ, hour: "2-digit", minute: "2-digit" }).format(d);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: TEAM_TZ, day: "numeric", month: "short" }).format(d);
  const tomorrow = new Date(now.getTime() + 86400_000);
  const label = day(d) === day(now) ? `Today ${time}` : day(d) === day(tomorrow) ? `Tomorrow ${time}` : date;
  return d < now && day(d) !== day(now) ? `Overdue · ${label}` : label;
}

/** Which bucket a due date falls in for the Tasks page. */
export function bucket(iso: string | null, now = new Date()): "overdue" | "today" | "upcoming" | "someday" {
  if (!iso) return "someday";
  const d = new Date(iso);
  if (day(d) === day(now)) return "today";
  return d < now ? "overdue" : "upcoming";
}

export function toTaskItem(t: TaskRowData, team: Member[], now = new Date()): TaskItem {
  return {
    id: t.id, title: t.title, due_at: t.due_at, done_at: t.done_at, company_id: t.company_id, company: t.companies?.name ?? null,
    assignee: t.assignee_id ? memberName(team.find((m) => m.id === t.assignee_id)) : null,
    overdue: bucket(t.due_at, now) === "overdue", dueLabel: dueLabel(t.due_at, now),
  };
}
