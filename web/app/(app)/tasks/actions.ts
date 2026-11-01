"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { teamLocalToIso } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

// Tasks run as the signed-in user; RLS (migration 0012) lets the team see and update
// them, and only the creator or an owner delete one.

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

async function attempt(fn: () => Promise<string | void>, paths: string[]): Promise<ActionResult> {
  try {
    const message = await fn();
    for (const p of paths) revalidatePath(p);
    return message ? { ok: true, message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
const pathsFor = (companyId: string | null) => ["/tasks", "/dashboard", ...(companyId ? [`/leads/${companyId}`] : [])];

export async function addTask(companyId: string | null, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const title = str(form, "title");
    if (!title) throw new Error("Write what needs doing");
    const supabase = await supabaseServer();
    const assignee = str(form, "assignee_id");
    const { error } = await supabase.from("tasks").insert({
      company_id: uuid(companyId), title: title.slice(0, 300), due_at: teamLocalToIso(str(form, "due_at")),
      ...(assignee && assignee !== "me" ? { assignee_id: uuid(assignee) } : {}),
    });
    if (error) throw new Error(error.message);
    return "Task added";
  }, pathsFor(companyId));
}

export async function setTaskDone(id: string, companyId: string | null, done: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { data: me } = await supabase.rpc("current_member_id");
    const { error } = await supabase.from("tasks").update(done ? { done_at: new Date().toISOString(), done_by: me } : { done_at: null, done_by: null }).eq("id", id);
    if (error) throw new Error(error.message);
  }, pathsFor(companyId));
}

export async function deleteTask(id: string, companyId: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.from("tasks").delete().eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Only the person who added it (or an owner) can delete it");
    return "Deleted";
  }, pathsFor(companyId));
}

/** A lead's "next step" is done: clear it (it shows on the Tasks page while it's due). */
export async function clearNextStep(companyId: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { error } = await supabase.from("companies").update({ next_step: null, next_step_at: null }).eq("id", companyId);
    if (error) throw new Error(error.message);
  }, pathsFor(companyId));
}
