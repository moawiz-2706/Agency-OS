"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { STAGES } from "@/lib/crm";
import { stepProblems, type Step } from "@/lib/sequences";
import type { ActionResult } from "@/lib/action-result";

// Sequences run as the signed-in user: RLS lets team members edit them, and the
// database functions (migration 0010) create the drafts and check every contact.

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return message ? { ok: true, message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

async function check<T extends { error: { message: string } | null }>(p: PromiseLike<T>) {
  const res = await p;
  if (res.error) throw new Error(res.error.message);
  return res;
}

// A starting point for the "Never miss a lead" offer; edit it on the sequence page.
const STARTER: Step[] = [
  {
    day: 1, subject: "Missed calls at {{company}}?",
    body: "Hi {{first_name}},\n\n{{personal_line}}\n\nMost {{trade}} businesses in {{city}} lose jobs to calls that go to voicemail after hours. "
      + "We set up an instant text-back so every missed caller hears from you within a minute, and can book themselves in.\n\n"
      + "Worth a 15-minute look?\n\n{{my_name}}",
  },
  {
    day: 4, subject: "",
    body: "Hi {{first_name}}, quick follow-up.\n\nOne roofing client of ours booked 6 extra jobs in the first month just from missed-call texts. "
      + "Happy to show you how it would work for {{company}}.\n\n{{my_name}}",
  },
  {
    day: 9, subject: "",
    body: "Hi {{first_name}}, last note from me.\n\nIf missed calls or slow replies to web leads aren't a problem for {{company}}, no worries at all. "
      + "If they are, reply \"yes\" and I'll send a short video of the setup.\n\n{{my_name}}",
  },
];

export async function createSequence(form: FormData) {
  const name = str(form, "name");
  if (!name) throw new Error("Give the sequence a name");
  const supabase = await supabaseServer();
  const { data: templates } = await check(supabase.from("templates")
    .insert(STARTER.map((s, i) => ({ name: `${name} · step ${i + 1}`, step: i + 1, subject: s.subject, body: s.body })))
    .select("id,step"));
  const ordered = (templates ?? []).sort((a, b) => a.step - b.step);
  const { data } = await check(supabase.from("campaigns").insert({
    name, description: str(form, "description"), template_ids: ordered.map((t) => t.id), step_days: STARTER.map((s) => s.day),
  }).select("id").single());
  revalidatePath("/sequences");
  redirect(`/sequences/${data!.id}`);
}

export async function saveSequence(id: string, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const count = Math.min(8, Number(str(form, "count") ?? 0));
    const steps: (Step & { template_id: string | null })[] = Array.from({ length: count }, (_, i) => ({
      day: Number(str(form, `day_${i}`)), subject: str(form, `subject_${i}`) ?? "", body: str(form, `body_${i}`) ?? "",
      template_id: uuid(str(form, `template_${i}`)),
    }));
    const problems = stepProblems(steps);
    if (problems.length) throw new Error(problems.join(". "));
    const name = str(form, "name");
    if (!name) throw new Error("Give the sequence a name");
    const time = str(form, "send_time") ?? "08:00";
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Pick a send time");

    const supabase = await supabaseServer();
    const { data: cp } = await check(supabase.from("campaigns").select("template_ids").eq("id", id).single());
    const ids: string[] = [];
    for (const [i, s] of steps.entries()) {
      const row = { name: `${name} · step ${i + 1}`, step: i + 1, subject: s.subject, body: s.body };
      if (s.template_id && (cp?.template_ids as string[] | undefined)?.includes(s.template_id)) {
        await check(supabase.from("templates").update(row).eq("id", s.template_id));
        ids.push(s.template_id);
      } else {
        const { data } = await check(supabase.from("templates").insert(row).select("id").single());
        ids.push(data!.id);
      }
    }
    await check(supabase.from("campaigns").update({
      name, description: str(form, "description"), template_ids: ids, step_days: steps.map((s) => s.day),
      send_time: time, skip_weekends: form.get("skip_weekends") === "on",
    }).eq("id", id));
    revalidatePath(`/sequences/${id}`);
    return "Saved. Changes apply to leads you add from now on; drafts already made stay as they are.";
  });
}

type EnrollResult = { enrolled: number; skipped: { company: string; reason: string }[] };
function describe(r: EnrollResult) {
  const skipped = r.skipped.length
    ? ` ${r.skipped.length} skipped: ${r.skipped.slice(0, 5).map((s) => `${s.company} (${s.reason})`).join("; ")}${r.skipped.length > 5 ? "…" : ""}`
    : "";
  return `${r.enrolled} lead${r.enrolled === 1 ? "" : "s"} added; their emails are waiting for your approval.${skipped}`;
}

/** Add these leads; drafts are made from my inbox. Used by the sequence page, the leads table and a lead's page. */
export async function enrollCompanies(id: string, companyIds: string[], start: string | null = null, account: string | null = null): Promise<ActionResult> {
  return attempt(async () => {
    const ids = companyIds.filter((v) => uuid(v));
    if (!ids.length) throw new Error("No leads selected");
    const supabase = await supabaseServer();
    const { data } = await check(supabase.rpc("enroll_in_sequence", {
      p_campaign: id, p_companies: ids, p_start: start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null, p_account: uuid(account),
    }));
    revalidatePath(`/sequences/${id}`);
    revalidatePath("/leads", "layout");
    return describe(data as EnrollResult);
  });
}

/** Add leads matching a filter (stage, trade, region, score), skipping ones already in it. */
export async function enrollByFilter(id: string, form: FormData): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const limit = Math.max(1, Math.min(200, Number(str(form, "limit") ?? 20)));
  const stage = str(form, "stage") ?? "ready";
  let q = supabase.from("companies").select("id").order("score", { ascending: false, nullsFirst: false }).limit(limit * 3);
  if (stage !== "any" && (STAGES as readonly string[]).includes(stage)) q = q.eq("stage", stage);
  const pick = (k: string) => (str(form, k) === "any" ? null : str(form, k));
  if (pick("trade")) q = q.eq("trade", pick("trade")!);
  if (pick("region")) q = q.eq("region", pick("region")!);
  if (str(form, "min_score")) q = q.gte("score", Number(str(form, "min_score")));
  if (form.get("mine") === "on") q = q.eq("owner_id", (await supabase.rpc("current_member_id")).data as string);
  const [{ data: found, error }, { data: inIt }] = await Promise.all([
    q, supabase.from("campaign_members").select("company_id").eq("campaign_id", id),
  ]);
  if (error) return { ok: false, error: error.message };
  const taken = new Set((inIt ?? []).map((m) => m.company_id));
  const ids = (found ?? []).map((c) => c.id).filter((c) => !taken.has(c)).slice(0, limit);
  if (!ids.length) return { ok: false, error: "No leads match that filter (or they're all in this sequence already)" };
  return enrollCompanies(id, ids, str(form, "start"), str(form, "from_account") === "auto" ? null : str(form, "from_account"));
}

export async function approveAllDrafts(id: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { data } = await check(supabase.rpc("approve_sequence_drafts", { p_campaign: id }));
    const r = data as { approved: number; blocked: number };
    revalidatePath(`/sequences/${id}`);
    return `${r.approved} email(s) approved: each goes out at its scheduled time while sending is on.`
      + (r.blocked ? ` ${r.blocked} couldn't be approved (the contact can't be emailed any more).` : "");
  });
}

export async function setSequenceStatus(id: string, status: "active" | "paused"): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    await check(supabase.rpc("set_sequence_status", { p_campaign: id, p_status: status }));
    revalidatePath(`/sequences/${id}`);
    revalidatePath("/sequences");
    return status === "paused" ? "Paused: approved emails went back to needing approval" : "Resumed";
  });
}

export async function removeFromSequence(id: string, companyId: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { data } = await check(supabase.rpc("remove_from_sequence", { p_campaign: id, p_company: companyId }));
    revalidatePath(`/sequences/${id}`);
    return `Removed; ${data} email(s) cancelled`;
  });
}
