"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { zonedLocalToIso } from "@/lib/tz";
import { revokeMemberToken, runMail } from "@/lib/mail/worker";
import type { ActionResult } from "@/lib/action-result";

// Email actions. Writes go through database functions that check who is calling
// (an email always goes out from its author's own inbox); "send now" and "sync now"
// run the mail worker for the caller's inbox only.

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return message ? { ok: true, message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

async function me() {
  const { member } = await currentMember();
  if (!member) throw new Error("Not on the team");
  return member;
}

/** Run the worker for my inbox now and describe what happened to the email. */
async function sendMineNow(): Promise<string> {
  const [r] = await runMail({ memberId: (await me()).id });
  if (!r) return "Approved. Connect your Gmail on the Account page to send it.";
  if (r.error) throw new Error(r.error);
  return r.sent ? `Sent to ${r.sent}` : "Approved. It goes out at the next run (within 5 minutes; sending must be on, and 2 minutes apart).";
}

export async function queueEmail(companyId: string, tz: string, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const when = zonedLocalToIso(str(form, "send_at"), tz);
    const approve = form.get("approve") === "on";
    await rpc("queue_email", {
      p_company: companyId, p_contact: str(form, "contact_id"), p_subject: str(form, "subject"), p_body: str(form, "body"),
      p_scheduled_for: when, p_approve: approve,
    });
    revalidatePath(`/leads/${companyId}`);
    if (!approve) return "Saved for approval";
    return when && new Date(when) > new Date() ? "Scheduled" : sendMineNow();
  });
}

export async function updateEmail(id: string, companyId: string, tz: string, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("update_email", {
      p_id: id, p_subject: str(form, "subject"), p_body: str(form, "body"), p_scheduled_for: zonedLocalToIso(str(form, "send_at"), tz),
    });
    revalidatePath(`/leads/${companyId}`);
    return "Saved";
  });
}

export async function approveEmail(id: string, companyId: string): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("approve_email", { p_id: id, p_now: false });
    revalidatePath(`/leads/${companyId}`);
    return "Approved: it goes out at its scheduled time";
  });
}

export async function sendEmailNow(id: string, companyId: string): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("approve_email", { p_id: id, p_now: true });
    const msg = await sendMineNow();
    revalidatePath(`/leads/${companyId}`);
    return msg;
  });
}

export async function approveAllForLead(companyId: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.from("outreach_messages").select("id")
      .eq("company_id", companyId).eq("member_id", (await me()).id).eq("status", "pending_approval");
    if (error) throw new Error(error.message);
    for (const m of data ?? []) await rpc("approve_email", { p_id: m.id, p_now: false });
    revalidatePath(`/leads/${companyId}`);
    return `${data?.length ?? 0} email(s) approved`;
  });
}

export async function cancelEmail(id: string, companyId: string): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("cancel_email", { p_id: id });
    revalidatePath(`/leads/${companyId}`);
    return "Cancelled";
  });
}

export async function markReplyHandled(id: string, handled: boolean): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("mark_reply_handled", { p_id: id, p_handled: handled });
    revalidatePath("/inbox");
    revalidatePath("/leads", "layout");
  });
}

export async function saveMailSettings(form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("save_my_mail_settings", {
      p_from_name: str(form, "from_name"), p_signature: str(form, "signature"), p_daily_limit: Number(str(form, "daily_limit") ?? 20),
    });
    revalidatePath("/account");
    return "Email settings saved";
  });
}

export async function syncMyInbox(): Promise<ActionResult> {
  return attempt(async () => {
    const [r] = await runMail({ memberId: (await me()).id, send: false });
    if (!r) throw new Error("Connect your Gmail first");
    if (r.error) throw new Error(r.error);
    revalidatePath("/", "layout");
    const s = r.synced ?? {};
    return `Synced: ${s.sent ?? 0} sent from Gmail, ${s.replies ?? 0} replies, ${s.bounces ?? 0} bounces`;
  });
}

export async function disconnectGmail(): Promise<ActionResult> {
  return attempt(async () => {
    await revokeMemberToken((await me()).id);   // tell Google too, so the access is really gone
    await rpc("disconnect_my_mail_account");
    revalidatePath("/account");
    return "Gmail disconnected";
  });
}

export async function setSendingEnabled(on: boolean): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("set_sending_enabled", { p_on: on });
    revalidatePath("/account");
    return on ? "Sending is on" : "Sending is off: nothing will go out";
  });
}
