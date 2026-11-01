"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { zonedLocalToIso } from "@/lib/tz";
import { revokeInbox, runMail } from "@/lib/mail/worker";
import { PRESETS, testLogin, type PresetKey } from "@/lib/mail/imap";
import { encryptToken } from "@/lib/mail/crypto";
import { memberName } from "@/lib/crm";
import { after } from "next/server";
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

/** Run the worker for my inboxes now and describe what happened to the email. */
async function sendMineNow(): Promise<string> {
  const reports = await runMail({ memberId: (await me()).id });
  if (!reports.length) return "Approved. Connect an inbox on the Account page to send it.";
  const sent = reports.find((r) => r.sent);
  if (sent) return `Sent to ${sent.sent} from ${sent.email}`;
  const failed = reports.find((r) => r.error);
  if (failed) throw new Error(failed.error);
  return "Approved. It goes out at the next run (within 5 minutes; sending must be on, and 2 minutes apart).";
}

export async function queueEmail(companyId: string, tz: string, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const when = zonedLocalToIso(str(form, "send_at"), tz);
    const approve = form.get("approve") === "on";
    await rpc("queue_email", {
      p_company: companyId, p_contact: str(form, "contact_id"), p_subject: str(form, "subject"), p_body: str(form, "body"),
      p_scheduled_for: when, p_approve: approve,
      p_account: str(form, "from_account") === "auto" ? null : str(form, "from_account"),
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

export async function saveMailSettings(accountId: string, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("save_my_mail_settings", {
      p_account: accountId, p_from_name: str(form, "from_name"), p_signature: str(form, "signature"),
      p_daily_limit: Number(str(form, "daily_limit") ?? 20),
    });
    revalidatePath("/account");
    return "Inbox settings saved";
  });
}

export async function setDefaultInbox(accountId: string): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("set_default_mail_account", { p_account: accountId });
    revalidatePath("/account");
    return "Default inbox changed";
  });
}

export async function syncMyInbox(): Promise<ActionResult> {
  return attempt(async () => {
    const reports = await runMail({ memberId: (await me()).id, send: false });
    if (!reports.length) throw new Error("Connect an inbox first");
    revalidatePath("/", "layout");
    const failed = reports.filter((r) => r.error);
    if (failed.length === reports.length) throw new Error(failed.map((r) => r.error).join("; "));
    const n = (k: string) => reports.reduce((t, r) => t + (r.synced?.[k] ?? 0), 0);
    return `Synced ${reports.length} inbox(es): ${n("sent")} sent by hand, ${n("replies")} replies, ${n("bounces")} bounces`
      + (failed.length ? `. Problem with ${failed.map((r) => r.email).join(", ")}` : "");
  });
}

export async function disconnectInbox(accountId: string): Promise<ActionResult> {
  return attempt(async () => {
    await revokeInbox((await me()).id, accountId);   // Gmail: tell Google too, so the access is really gone
    await rpc("disconnect_my_mail_account", { p_account: accountId });
    revalidatePath("/account");
    return "Inbox disconnected; its stored password or token is deleted";
  });
}

/** GoDaddy (or any IMAP/SMTP) inbox: test the login, then store the password encrypted. */
export async function connectImapInbox(form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const member = await me();
    const email = str(form, "email")?.toLowerCase();
    const password = form.get("password");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter the full email address");
    if (typeof password !== "string" || !password) throw new Error("Enter the mailbox password");
    const port = (k: string, fallback: number) => {
      const n = Number(str(form, k) ?? fallback);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error("Check the port numbers");
      return n;
    };
    // "auto" tries GoDaddy's newer Titan servers, then its classic ones (one login attempt each).
    const preset = str(form, "preset") ?? "auto";
    const candidates = preset === "custom"
      ? [{
          imap_host: (str(form, "imap_host") ?? "").toLowerCase(), imap_port: port("imap_port", 993),
          smtp_host: (str(form, "smtp_host") ?? "").toLowerCase(), smtp_port: port("smtp_port", 465),
        }]
      : preset in PRESETS ? [PRESETS[preset as PresetKey]] : [PRESETS.titan, PRESETS.godaddy_classic];
    let settings: Parameters<typeof testLogin>[0] | null = null;
    const problems: string[] = [];
    for (const servers of candidates) {
      if (!servers.imap_host || !servers.smtp_host) throw new Error("Enter both server names");
      try {
        await testLogin({ email, password, ...servers });
        settings = { email, password, ...servers };
        break;
      } catch (e) {
        problems.push(`${servers.imap_host}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!settings) {
      throw new Error(candidates.length > 1
        ? `Couldn't log in on GoDaddy's servers. Check the password at your webmail first. Details: ${problems.join(" | ")}`
        : problems[0]);
    }
    await rpc("save_my_imap_account", {
      p_email: email, p_from_name: memberName(member), p_secret_encrypted: encryptToken(password, email),
      p_imap_host: settings.imap_host, p_imap_port: settings.imap_port, p_smtp_host: settings.smtp_host, p_smtp_port: settings.smtp_port,
    });
    after(() => runMail({ memberId: member.id, send: false }).catch(() => {}));   // first sync looks back 14 days
    revalidatePath("/account");
    return `${email} connected. Add its signature below.`;
  });
}

export async function setSendingEnabled(on: boolean): Promise<ActionResult> {
  return attempt(async () => {
    await rpc("set_sending_enabled", { p_on: on });
    revalidatePath("/account");
    return on ? "Sending is on" : "Sending is off: nothing will go out";
  });
}
