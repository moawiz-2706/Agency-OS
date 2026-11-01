"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { TEAM_TZ, teamLocalToIso } from "@/lib/format";
import { myImapInboxes, runMail } from "@/lib/mail/worker";
import { sendDirect } from "@/lib/mail/imap";
import { FOLDERS, getMessage, moveMessage, setFlag, type FlagOp, type Folder } from "@/lib/mail/mailbox";
import {
  MAX_RECIPIENTS, checkRecipients, directText, forwardBlock, parseAddressList, quoteReply,
  type RecipientContact, type Suppression,
} from "@/lib/mail/compose";
import type { ActionResult } from "@/lib/action-result";

// Mailbox actions: always on the caller's own inbox, checked on the server (the inbox
// list comes from the database, never from the form). Hand-written email goes out
// straight away like webmail does: the Account page's sending switch and daily limit
// are for scheduled outreach. The never-contact list and consent rules still apply.

const MAX_UPLOAD = 4 * 1024 * 1024;      // what a web request to Vercel can carry
const MAX_FORWARDED = 20 * 1024 * 1024;  // attachments carried over when forwarding

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const folderOf = (v: string | null): Folder => (FOLDERS as readonly string[]).includes(v ?? "") ? (v as Folder) : "inbox";

async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return message ? { ok: true, message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

async function myInbox(inboxId: string | null) {
  const { member } = await currentMember();
  if (!member) throw new Error("Not on the team");
  const inbox = (await myImapInboxes(member.id)).find((i) => i.id === inboxId);
  if (!inbox) throw new Error("That inbox isn't one of yours (or it needs reconnecting on the Account page)");
  return { member, inbox };
}

/** Lead contacts and never-contact entries for these addresses (team-readable through RLS). */
async function recipientRecords(emails: string[]) {
  const supabase = await supabaseServer();
  const domains = [...new Set(emails.map((e) => e.split("@")[1]))];
  const [contacts, byEmail, byDomain] = await Promise.all([
    supabase.from("contacts").select("email,do_not_contact,email_status,consent_basis,companies(name,country,stage)").in("email", emails),
    supabase.from("suppressions").select("email,domain").in("email", emails),
    supabase.from("suppressions").select("email,domain").in("domain", domains),
  ]);
  for (const r of [contacts, byEmail, byDomain]) if (r.error) throw new Error(r.error.message);
  type Row = Omit<RecipientContact, "company"> & { companies: RecipientContact["company"] };
  return {
    contacts: ((contacts.data ?? []) as unknown as Row[]).map(({ companies, ...c }) => ({ ...c, company: companies })),
    suppressions: [...(byEmail.data ?? []), ...(byDomain.data ?? [])] as Suppression[],
  };
}

export async function sendFromMailbox(form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const { member, inbox } = await myInbox(str(form, "inbox"));
    const mode = (["reply", "replyall", "forward"] as const).find((m) => m === str(form, "mode")) ?? "new";
    const to = parseAddressList(str(form, "to"));
    const cc = parseAddressList(str(form, "cc"));
    const bcc = parseAddressList(str(form, "bcc"));
    const all = [...new Set([...to, ...cc, ...bcc])];
    if (!to.length) throw new Error("Add at least one address in To");
    if (all.length > MAX_RECIPIENTS) throw new Error(`Up to ${MAX_RECIPIENTS} recipients per email. For more, use an outreach sequence.`);
    const subject = str(form, "subject");
    if (!subject) throw new Error("Add a subject");
    const body = str(form, "body") ?? "";
    if (!body && mode !== "forward") throw new Error("Write a message");

    // "Schedule send": the time is typed in the team's time zone.
    const sendAt = teamLocalToIso(str(form, "send_at"));
    const later = !!sendAt && new Date(sendAt).getTime() > Date.now() + 60_000;
    if (str(form, "send_at") && !later) throw new Error("Pick a time in the future to schedule it, or send it now");

    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.reduce((t, f) => t + f.size, 0) > MAX_UPLOAD) throw new Error("Attachments can be up to 4 MB in total");
    const attachments: { filename: string; content: Buffer; contentType: string }[] = await Promise.all(files.map(async (f) => ({
      filename: f.name || "attachment", content: Buffer.from(await f.arrayBuffer()), contentType: f.type || "application/octet-stream",
    })));

    // Replies and forwards: the original comes from the mail server, not from the form.
    let quoted: string | null = null;
    let inReplyTo: string | null = null;
    let references: string | null = null;
    const srcFolder = folderOf(str(form, "src_folder"));
    const srcUid = Number(str(form, "src_uid")) || null;
    if (mode !== "new") {
      if (!srcUid) throw new Error("The original email is missing");
      const { message, files: originals } = await getMessage(inbox.settings, srcFolder, srcUid);
      if (mode === "forward") {
        quoted = forwardBlock(message, TEAM_TZ);
        if (form.get("keep_files") === "on") {
          if (originals.reduce((t, a) => t + a.size, 0) > MAX_FORWARDED) throw new Error("The original's attachments are over 20 MB: untick them, or forward from webmail");
          attachments.push(...originals.map((a) => ({ filename: a.filename || "attachment", content: a.content, contentType: a.contentType })));
        }
      } else {
        if (form.get("quote") === "on") quoted = quoteReply(message, TEAM_TZ);
        inReplyTo = message.messageId;
        references = message.references;
      }
    }

    const reply = mode === "reply" || mode === "replyall";
    const { contacts, suppressions } = await recipientRecords(all);
    const check = checkRecipients(all, contacts, suppressions, reply);
    if (check.problems.length) {
      throw new Error(`Not sent: ${check.problems.map((p) => `${p.email} ${p.reason}`).join("; ")}`);
    }

    // The inbox's signature (name, postal address) from the Account page.
    const supabase = await supabaseServer();
    const { data: accounts } = await supabase.rpc("my_mail_accounts");
    const account = ((accounts ?? []) as { id: string; from_name: string | null; signature: string | null }[]).find((a) => a.id === inbox.id);
    const withSignature = form.get("signature") === "on";
    if (check.optOut && !account?.signature?.trim()) throw new Error("Add this inbox's signature (with your postal address) on the Account page before emailing a lead");

    const text = directText({ body, signature: withSignature || check.optOut ? account?.signature : null, optOut: check.optOut, quoted });
    if (later) {
      if (attachments.length) throw new Error("Scheduled emails can't carry attachments yet: send it now, or remove them");
      await supabase.rpc("schedule_my_mail", {
        p_account: inbox.id, p_to: to, p_cc: cc, p_bcc: bcc, p_subject: subject, p_body: text,
        p_in_reply_to: inReplyTo, p_references: references, p_send_at: sendAt,
      }).then(({ error }) => { if (error) throw new Error(error.message); });
      revalidatePath("/mailbox");
      return `Scheduled for ${new Date(sendAt!).toLocaleString("en-GB", { timeZone: TEAM_TZ, dateStyle: "medium", timeStyle: "short" })}`;
    }

    await sendDirect(inbox.settings, {
      from_name: account?.from_name ?? null, to, cc, bcc, subject, text, in_reply_to: inReplyTo, references, attachments,
    });
    if (reply && srcUid) await setFlag(inbox.settings, srcFolder, srcUid, "answered").catch(() => {});
    // Email to a lead shows on its timeline after the next sync; run one now.
    if (check.leads.length) after(() => runMail({ memberId: member.id, send: false }).catch(() => {}));
    revalidatePath("/mailbox");
    return `Sent to ${all.join(", ")}${check.leads.length ? ` · logged on ${check.leads.join(", ")}` : ""}`;
  });
}

export async function flagMessage(inboxId: string, folder: Folder, uid: number, op: FlagOp): Promise<ActionResult> {
  return attempt(async () => {
    const { inbox } = await myInbox(inboxId);
    await setFlag(inbox.settings, folderOf(folder), uid, op);
    revalidatePath("/mailbox");
  });
}

export async function moveTo(inboxId: string, folder: Folder, uid: number, to: Folder): Promise<ActionResult> {
  return attempt(async () => {
    const { inbox } = await myInbox(inboxId);
    await moveMessage(inbox.settings, folderOf(folder), uid, folderOf(to));
    revalidatePath("/mailbox");
    return to === "trash" ? "Moved to Trash" : to === "archive" ? "Archived" : to === "inbox" ? "Moved to Inbox" : "Moved";
  });
}

export async function cancelScheduled(id: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { error } = await supabase.rpc("cancel_my_scheduled_mail", { p_id: id });
    if (error) throw new Error(error.message);
    revalidatePath("/mailbox");
    return "Cancelled: it won't be sent";
  });
}
