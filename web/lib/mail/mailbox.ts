import "server-only";
import { simpleParser, type AddressObject } from "mailparser";
import { openImap, sentFolder, type ImapSettings } from "./imap.ts";
import { htmlToText } from "./message.ts";

// The Mailbox page: reads an IMAP inbox (GoDaddy etc.) live, for its owner only.
// Nothing here is written to the database, and messages are fetched with
// BODY.PEEK, so opening one here doesn't mark it read in webmail.

export type Folder = "inbox" | "sent";
export type MailboxItem = {
  uid: number; from: string; fromName: string | null; to: string[]; subject: string; date: string | null; seen: boolean; flagged: boolean;
};
export type MailMessage = {
  uid: number; from: string; fromText: string; to: string; cc: string; subject: string; date: string | null; text: string;
  attachments: { filename: string; size: number }[]; addresses: string[];
};

const addrText = (a: AddressObject | AddressObject[] | undefined) => (Array.isArray(a) ? a.map((x) => x.text).join(", ") : a?.text ?? "");
const addrList = (a: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value.map((v) => v.address?.toLowerCase() ?? "")).filter(Boolean);

async function withFolder<T>(s: ImapSettings, folder: Folder, fn: (c: Awaited<ReturnType<typeof openImap>>, total: number) => Promise<T>, empty: T) {
  const c = await openImap(s);
  try {
    const path = folder === "inbox" ? "INBOX" : await sentFolder(c);
    if (!path) return empty;
    const lock = await c.getMailboxLock(path, { readOnly: true });
    try {
      return await fn(c, c.mailbox ? c.mailbox.exists : 0);
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
}

/** One page of a folder, newest first. */
export function listFolder(s: ImapSettings, folder: Folder, page: number, size = 25) {
  return withFolder(s, folder, async (c, total) => {
    const end = total - page * size;
    if (end < 1) return { total, items: [] as MailboxItem[] };
    const start = Math.max(1, end - size + 1);
    const items: MailboxItem[] = [];
    for await (const m of c.fetch(`${start}:${end}`, { uid: true, envelope: true, flags: true, internalDate: true })) {
      const env = m.envelope;
      const from = env?.from?.[0];
      items.push({
        uid: m.uid,
        from: from?.address?.toLowerCase() ?? "",
        fromName: from?.name || null,
        to: [...(env?.to ?? []), ...(env?.cc ?? [])].map((a) => a.address?.toLowerCase() ?? "").filter(Boolean),
        subject: env?.subject || "(no subject)",
        date: (() => {
          const d = env?.date ?? m.internalDate;
          const t = d ? new Date(d) : null;
          return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
        })(),
        seen: m.flags?.has("\\Seen") ?? false,
        flagged: m.flags?.has("\\Flagged") ?? false,
      });
    }
    return { total, items: items.sort((a, b) => b.uid - a.uid) };
  }, { total: 0, items: [] as MailboxItem[] });
}

/** One full message, as plain text (HTML email is converted to text, never rendered). */
export function readMessage(s: ImapSettings, folder: Folder, uid: number) {
  return withFolder<MailMessage | null>(s, folder, async (c) => {
    const m = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
    if (!m || !m.source) return null;
    const p = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true });
    const from = addrList(p.from)[0] ?? "";
    return {
      uid,
      from,
      fromText: addrText(p.from),
      to: addrText(p.to),
      cc: addrText(p.cc),
      subject: p.subject || "(no subject)",
      date: p.date?.toISOString() ?? null,
      text: (p.text ?? (typeof p.html === "string" ? htmlToText(p.html) : "")).replace(/\r\n?/g, "\n").trim(),
      attachments: p.attachments.map((a) => ({ filename: a.filename || "attachment", size: a.size })),
      addresses: [...new Set([from, ...addrList(p.to), ...addrList(p.cc)])].filter(Boolean),
    };
  }, null);
}

/** Where the owner reads this inbox on the web. */
export function webmailUrl(imapHost: string) {
  if (/titan\.email$/.test(imapHost)) return "https://secureserver.titan.email/mail/";
  if (/secureserver\.net$/.test(imapHost)) return "https://email.godaddy.com/";
  return null;
}
