import "server-only";
import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { addresses, buildMime, imapThreadId, type SyncMessage } from "./message.ts";
import { imapToSync } from "./imap-parse.ts";

// Inboxes that use plain IMAP (read) + SMTP (send) with the mailbox password:
// GoDaddy Professional Email, and most other hosts. The password is only ever held
// in memory here, decrypted for the run.

/** Server settings by host. GoDaddy sells two kinds of mailbox: newer ones run on Titan (webmail at *.titan.email). */
export const PRESETS = {
  titan: { imap_host: "imap.titan.email", imap_port: 993, smtp_host: "smtp.titan.email", smtp_port: 465 },
  godaddy_classic: { imap_host: "imap.secureserver.net", imap_port: 993, smtp_host: "smtpout.secureserver.net", smtp_port: 465 },
} as const;
export type PresetKey = keyof typeof PRESETS;
export type ImapSettings = { email: string; password: string; imap_host: string; imap_port: number; smtp_host: string; smtp_port: number };
export type Brief = { id: string; thread_id: string; from: string; to: string[] };

/** The mail server refused the password: the inbox needs reconnecting. */
export class MailAuthError extends Error {}

const MAX_PER_FOLDER = 300;
const errText = (e: unknown) => (e instanceof Error ? `${e.message} ${(e as { response?: string }).response ?? ""}` : String(e));
const isAuthFailure = (e: unknown) =>
  (e as { authenticationFailed?: boolean })?.authenticationFailed === true || (e as { code?: string })?.code === "EAUTH"
  || /AUTHENTICATIONFAILED|invalid credentials|authentication failed|login failed|535/i.test(errText(e));

function imapClient(s: ImapSettings) {
  return new ImapFlow({
    host: s.imap_host, port: s.imap_port, secure: s.imap_port === 993,
    auth: { user: s.email, pass: s.password }, logger: false,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 40_000,
  });
}

function smtpTransport(s: ImapSettings) {
  return nodemailer.createTransport({
    host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port === 465, requireTLS: s.smtp_port !== 465,
    auth: { user: s.email, pass: s.password },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 40_000,
  });
}

export async function openImap(s: ImapSettings) {
  const c = imapClient(s);
  try {
    await c.connect();
    return c;
  } catch (e) {
    if (isAuthFailure(e)) throw new MailAuthError(`${s.email}: the mail server rejected the email or password. Check them (or reconnect with the current password).`);
    throw new Error(`Couldn't reach ${s.imap_host}: ${errText(e).trim()}`);
  }
}

/** Check both the IMAP and the SMTP login before anything is saved. */
export async function testLogin(s: ImapSettings) {
  const c = await openImap(s);
  await c.logout().catch(() => {});
  try {
    await smtpTransport(s).verify();
  } catch (e) {
    if (isAuthFailure(e)) throw new MailAuthError("Reading mail works, but sending was refused. Check that SMTP is allowed for this mailbox.");
    throw new Error(`Couldn't reach ${s.smtp_host}: ${errText(e).trim()}`);
  }
}

export async function sentFolder(c: ImapFlow) {
  const list = await c.list();
  return list.find((f) => f.specialUse === "\\Sent")?.path
    ?? list.find((f) => /^(inbox[./])?sent( items| messages| mail)?$/i.test(f.path))?.path
    ?? null;
}

/**
 * Sync INBOX and Sent since `since` (IMAP searches by day, so a day of overlap is
 * re-read and de-duplicated by Message-ID). Only messages that `match` says involve a
 * lead, or that look like bounces, are downloaded in full.
 */
export async function syncImap(c: ImapFlow, s: ImapSettings, since: Date,
  match: (briefs: Brief[]) => Promise<string[]>, save: (msgs: SyncMessage[], cursor: string) => Promise<Record<string, number>>) {
  const startedAt = new Date();
  const sent = await sentFolder(c);
  const seen = new Map<string, Brief & { folder: string; uid: number; sent: boolean; bounce: boolean; date?: Date }>();

  for (const folder of ["INBOX", sent].filter((f): f is string => !!f)) {
    const lock = await c.getMailboxLock(folder);
    try {
      const uids = await c.search({ since: new Date(since.getTime() - 86400_000) }, { uid: true });
      if (!uids || !uids.length) continue;
      for await (const m of c.fetch(uids.slice(-MAX_PER_FOLDER), { uid: true, envelope: true, internalDate: true, headers: ["references"] }, { uid: true })) {
        const env = m.envelope;
        const msgId = env?.messageId ?? null;
        const id = msgId ? `rfc:${msgId}` : `imap:${s.email}:${folder}:${m.uid}`;
        if (seen.has(id)) continue;
        const refs = m.headers?.toString("utf8").replace(/^references:\s*/i, "").replace(/\r?\n[ \t]+/g, " ").trim() || null;
        const from = env?.from?.[0]?.address?.toLowerCase() ?? "";
        seen.set(id, {
          id, folder, uid: m.uid, sent: folder === sent, bounce: /^(mailer-daemon|postmaster)@/i.test(from),
          thread_id: imapThreadId(msgId, env?.inReplyTo ?? null, refs) ?? id,
          from, to: [...(env?.to ?? []), ...(env?.cc ?? [])].flatMap((a) => addresses(a.address)),
          date: m.internalDate instanceof Date ? m.internalDate : undefined,
        });
      }
    } finally {
      lock.release();
    }
  }

  const briefs = [...seen.values()];
  const matched = new Set(await match(briefs.map(({ id, thread_id, from, to }) => ({ id, thread_id, from, to }))));
  const threads = new Set(briefs.filter((b) => matched.has(b.id)).map((b) => b.thread_id));
  const wanted = briefs.filter((b) => matched.has(b.id) || threads.has(b.thread_id) || b.bounce);

  const msgs: SyncMessage[] = [];
  for (const folder of new Set(wanted.map((w) => w.folder))) {
    const inFolder = wanted.filter((w) => w.folder === folder);
    const byUid = new Map(inFolder.map((w) => [w.uid, w]));
    const lock = await c.getMailboxLock(folder);
    try {
      for await (const m of c.fetch(inFolder.map((w) => w.uid), { uid: true, source: true }, { uid: true })) {
        const b = byUid.get(m.uid);
        if (!b || !m.source) continue;
        msgs.push(await imapToSync(m.source, { id: b.id, mailbox: s.email, inSentFolder: b.sent, internalDate: b.date }));
      }
    } finally {
      lock.release();
    }
  }
  return save(msgs, startedAt.toISOString());
}

export type ImapClaim = {
  to: string; to_name: string | null; subject: string; body: string; thread_id: string | null;
  in_reply_to: string | null; references: string | null; from_email: string; from_name: string | null; signature: string;
};

/** Send over SMTP, then file a copy in Sent like a normal mail app would (SMTP alone doesn't). */
export async function sendImap(c: ImapFlow | null, s: ImapSettings, claim: ImapClaim) {
  const messageId = `<${randomUUID()}@${s.email.split("@")[1]}>`;
  const mime = buildMime({
    from_email: claim.from_email, from_name: claim.from_name, to: claim.to, to_name: claim.to_name, subject: claim.subject,
    body: claim.body, signature: claim.signature, in_reply_to: claim.in_reply_to, references: claim.references,
    message_id: messageId, date: new Date(),
  });
  try {
    await smtpTransport(s).sendMail({ envelope: { from: s.email, to: [claim.to] }, raw: mime });
  } catch (e) {
    if (isAuthFailure(e)) throw new MailAuthError(`${s.email}: the mail server refused to send with this password. Reconnect it.`);
    throw e;
  }
  if (c) {
    const folder = await sentFolder(c).catch(() => null);
    if (folder) await c.append(folder, mime, ["\\Seen"]).catch(() => {});
  }
  return { id: `rfc:${messageId}`, threadId: claim.thread_id ?? `rfc:${messageId}`, rfcId: messageId };
}
