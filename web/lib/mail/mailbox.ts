import "server-only";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { ImapFlow } from "imapflow";
import { openImap, type ImapSettings } from "./imap.ts";
import { htmlToText } from "./message.ts";

// The Mailbox page: a member's own IMAP inbox (GoDaddy etc.), read live from the mail
// server. Nothing here is stored in the database. Opening a message marks it read,
// like any mail app; star, archive and delete act on the server too, so webmail and
// phone apps stay in step. "Delete" only moves to Trash: emptying it is left to webmail.

export const FOLDERS = ["inbox", "sent", "drafts", "archive", "junk", "trash"] as const;
export type Folder = (typeof FOLDERS)[number];
export const FOLDER_LABEL: Record<Folder, string> = {
  inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive", junk: "Spam", trash: "Trash",
};

export type MailboxItem = {
  uid: number; from: string; fromName: string | null; to: string[]; subject: string; date: string | null;
  seen: boolean; flagged: boolean; answered: boolean;
};
export type Attachment = { index: number; filename: string; size: number; contentType: string };
export type MailMessage = {
  uid: number; messageId: string | null; references: string | null;
  from: string; fromText: string; replyTo: string[]; to: string[]; toText: string; cc: string[]; ccText: string;
  subject: string; date: string | null; text: string; html: string | null;
  attachments: Attachment[]; addresses: string[]; flagged: boolean;
};
export type MailboxView = {
  folders: Folder[]; unread: number; total: number; items: MailboxItem[]; message: MailMessage | null;
};

const SPECIAL: Partial<Record<Folder, string>> = { sent: "\\Sent", drafts: "\\Drafts", archive: "\\Archive", junk: "\\Junk", trash: "\\Trash" };
const NAMES: Partial<Record<Folder, RegExp>> = {
  sent: /^(inbox[./])?sent( items| messages| mail)?$/i,
  drafts: /^(inbox[./])?drafts?$/i,
  archive: /^(inbox[./])?(archive|archives|all mail)$/i,
  junk: /^(inbox[./])?(junk|spam|bulk)( e-?mail| mail)?$/i,
  trash: /^(inbox[./])?(trash|bin|deleted( items| messages)?)$/i,
};

/** Where each folder lives on this server (special-use flags first, then the usual names). */
async function folderPaths(c: ImapFlow) {
  const list = await c.list();
  const paths: Partial<Record<Folder, string>> = { inbox: "INBOX" };
  for (const f of FOLDERS.filter((x) => x !== "inbox")) {
    const hit = list.find((x) => x.specialUse === SPECIAL[f]) ?? list.find((x) => NAMES[f]!.test(x.path));
    if (hit) paths[f] = hit.path;
  }
  return paths;
}

async function session<T>(s: ImapSettings, fn: (c: ImapFlow, paths: Partial<Record<Folder, string>>) => Promise<T>) {
  const c = await openImap(s);
  try {
    return await fn(c, await folderPaths(c));
  } finally {
    await c.logout().catch(() => {});
  }
}

async function inFolder<T>(c: ImapFlow, path: string, fn: () => Promise<T>) {
  const lock = await c.getMailboxLock(path);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

const addrText = (a: AddressObject | AddressObject[] | undefined) => (Array.isArray(a) ? a.map((x) => x.text).join(", ") : a?.text ?? "");
const addrList = (a: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value.map((v) => v.address?.toLowerCase() ?? "")).filter(Boolean);
const iso = (d: Date | string | undefined | null) => {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
};
const parse = (source: Buffer) => simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
const attachmentsOf = (p: ParsedMail) => p.attachments.filter((a) => a.contentDisposition !== "inline" || !a.contentId);

function toMessage(uid: number, p: ParsedMail, flagged: boolean): MailMessage {
  // Inline pictures (cid:) become data: URLs so they show without loading anything remote.
  let html = typeof p.html === "string" ? p.html : null;
  if (html) {
    for (const a of p.attachments) {
      if (!a.contentId || a.size > 1_500_000 || !a.contentType.startsWith("image/")) continue;
      const cid = a.contentId.replace(/^<|>$/g, "");
      html = html.split(`cid:${cid}`).join(`data:${a.contentType};base64,${a.content.toString("base64")}`);
    }
  }
  const from = addrList(p.from)[0] ?? "";
  const to = addrList(p.to);
  const cc = addrList(p.cc);
  const refs = Array.isArray(p.references) ? p.references.join(" ") : p.references ?? null;
  return {
    uid, messageId: p.messageId ?? null, references: [refs, p.messageId].filter(Boolean).join(" ") || null,
    from, fromText: addrText(p.from), replyTo: addrList(p.replyTo),
    to, toText: addrText(p.to), cc, ccText: addrText(p.cc),
    subject: p.subject || "(no subject)", date: iso(p.date),
    text: (p.text ?? (html ? htmlToText(html) : "")).replace(/\r\n?/g, "\n").trim(),
    html,
    attachments: attachmentsOf(p).map((a, index) => ({
      index, filename: a.filename || "attachment", size: a.size, contentType: a.contentType || "application/octet-stream",
    })),
    addresses: [...new Set([from, ...to, ...cc])].filter(Boolean),
    flagged,
  };
}

/**
 * Everything one Mailbox page needs, over one connection: which folders exist, the
 * unread count, one page of the folder (or of a search in it), and the open message,
 * which is marked read.
 */
export function loadMailbox(s: ImapSettings, o: { folder: Folder; page: number; size: number; q: string | null; uid: number | null }) {
  return session<MailboxView>(s, async (c, paths) => {
    const folders = FOLDERS.filter((f) => paths[f]);
    const status = await c.status("INBOX", { unseen: true }).catch(() => null);
    const unread = (status && status.unseen) || 0;
    const path = paths[o.folder];
    if (!path) return { folders, unread, total: 0, items: [], message: null };
    return inFolder(c, path, async () => {
      // Newest first: a search returns UIDs; otherwise page by sequence number from the end.
      let range: string | number[] | null = null;
      let total = c.mailbox ? c.mailbox.exists : 0;
      if (o.q) {
        const q = o.q;
        const uids = ((await c.search({ or: [{ from: q }, { to: q }, { subject: q }, { body: q }] }, { uid: true })) || []).sort((a, b) => b - a);
        total = uids.length;
        const pageUids = uids.slice(o.page * o.size, (o.page + 1) * o.size);
        range = pageUids.length ? pageUids : null;
      } else {
        const end = total - o.page * o.size;
        if (end >= 1) range = `${Math.max(1, end - o.size + 1)}:${end}`;
      }
      const items: MailboxItem[] = [];
      if (range) {
        for await (const m of c.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: Array.isArray(range) })) {
          const env = m.envelope;
          const from = env?.from?.[0];
          items.push({
            uid: m.uid,
            from: from?.address?.toLowerCase() ?? "",
            fromName: from?.name || null,
            to: [...(env?.to ?? []), ...(env?.cc ?? [])].map((a) => a.address?.toLowerCase() ?? "").filter(Boolean),
            subject: env?.subject || "(no subject)",
            date: iso(env?.date ?? m.internalDate),
            seen: m.flags?.has("\\Seen") ?? false,
            flagged: m.flags?.has("\\Flagged") ?? false,
            answered: m.flags?.has("\\Answered") ?? false,
          });
        }
      }
      items.sort((a, b) => b.uid - a.uid);

      let message: MailMessage | null = null;
      let markedRead = false;
      if (o.uid) {
        const m = await c.fetchOne(String(o.uid), { uid: true, source: true, flags: true }, { uid: true });
        if (m && m.source) {
          if (!m.flags?.has("\\Seen")) {
            markedRead = await c.messageFlagsAdd(String(o.uid), ["\\Seen"], { uid: true }).catch(() => false);
            const it = items.find((x) => x.uid === o.uid);
            if (it) it.seen = true;
          }
          message = toMessage(o.uid, await parse(m.source), m.flags?.has("\\Flagged") ?? false);
        }
      }
      return { folders, unread: Math.max(0, unread - (o.folder === "inbox" && markedRead ? 1 : 0)), total, items, message };
    });
  });
}

async function fetchParsed(c: ImapFlow, uid: number) {
  const m = await c.fetchOne(String(uid), { uid: true, source: true, flags: true }, { uid: true });
  if (!m || !m.source) throw new Error("That email isn't there any more (moved or deleted elsewhere?)");
  return { parsed: await parse(m.source), flagged: m.flags?.has("\\Flagged") ?? false };
}

/** One message, for replying to or forwarding it (the server is the source of truth, not the form). */
export function getMessage(s: ImapSettings, folder: Folder, uid: number) {
  return session(s, async (c, paths) => {
    const path = paths[folder];
    if (!path) throw new Error("That folder doesn't exist on this mail server");
    return inFolder(c, path, async () => {
      const { parsed, flagged } = await fetchParsed(c, uid);
      return { message: toMessage(uid, parsed, flagged), files: attachmentsOf(parsed) };
    });
  });
}

/** One attachment's bytes. */
export function getAttachment(s: ImapSettings, folder: Folder, uid: number, index: number) {
  return getMessage(s, folder, uid).then(({ files }) => {
    const a = files[index];
    if (!a) throw new Error("Attachment not found");
    return { filename: a.filename || "attachment", contentType: a.contentType || "application/octet-stream", content: a.content };
  });
}

export type FlagOp = "read" | "unread" | "star" | "unstar" | "answered";
const FLAG: Record<FlagOp, [string, boolean]> = {
  read: ["\\Seen", true], unread: ["\\Seen", false], star: ["\\Flagged", true], unstar: ["\\Flagged", false], answered: ["\\Answered", true],
};

export function setFlag(s: ImapSettings, folder: Folder, uid: number, op: FlagOp) {
  return session(s, async (c, paths) => {
    const path = paths[folder];
    if (!path) throw new Error("That folder doesn't exist on this mail server");
    await inFolder(c, path, async () => {
      const [flag, on] = FLAG[op];
      if (on) await c.messageFlagsAdd(String(uid), [flag], { uid: true });
      else await c.messageFlagsRemove(String(uid), [flag], { uid: true });
    });
  });
}

/** Move to another folder. Archive is created if the server has none; nothing is ever permanently deleted here. */
export function moveMessage(s: ImapSettings, folder: Folder, uid: number, to: Folder) {
  return session(s, async (c, paths) => {
    const from = paths[folder];
    if (!from) throw new Error("That folder doesn't exist on this mail server");
    let target = paths[to];
    if (!target && to === "archive") {
      await c.mailboxCreate("Archive").catch(() => {});
      target = "Archive";
    }
    if (!target) throw new Error(`This mail server has no ${FOLDER_LABEL[to]} folder`);
    if (target === from) return;
    await inFolder(c, from, async () => {
      const ok = await c.messageMove(String(uid), target!, { uid: true });
      if (!ok) throw new Error("The mail server didn't move it");
    });
  });
}

/** Where the owner reads this inbox on the web. */
export function webmailUrl(imapHost: string) {
  if (/titan\.email$/.test(imapHost)) return "https://secureserver.titan.email/mail/";
  if (/secureserver\.net$/.test(imapHost)) return "https://email.godaddy.com/";
  return null;
}
