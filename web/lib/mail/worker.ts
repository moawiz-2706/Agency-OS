import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { ImapFlow } from "imapflow";
import { decryptToken } from "./crypto.ts";
import { envValue } from "./env.ts";
import { GoogleAuthError, accessToken, getMessage, listMessageIds, revokeToken, sendRaw } from "./google.ts";
import { MailAuthError, openImap, sendImap, syncImap, type Brief, type ImapSettings } from "./imap.ts";
import { addresses, buildRaw, header, toSyncMessage, type SyncMessage } from "./message.ts";

// One run for each connected inbox: sync it (your own sends, replies, bounces) into the
// CRM, then send at most one due, approved email. Gmail inboxes use the Gmail API;
// GoDaddy and other inboxes use IMAP + SMTP. Runs every 5 minutes from pg_cron, and
// on demand ("Sync now", "Send now"). It has no service-role key: the database only
// lets it in with MAILER_SECRET, and only into mail functions.

const MAX_PER_SYNC = 300;          // Gmail messages looked at per inbox per run; the cursor catches up next run
const OVERLAP_MS = 10 * 60_000;    // re-read the last 10 minutes so nothing slips between runs

type Account = {
  id: string; member_id: string; email: string; provider: "gmail" | "imap" | "microsoft"; from_name: string | null; token: string;
  synced_until: string | null; imap_host: string | null; imap_port: number | null; smtp_host: string | null; smtp_port: number | null;
};
type Claim = {
  id: string; to: string; to_name: string | null; subject: string; body: string; thread_id: string | null;
  in_reply_to: string | null; references: string | null; from_email: string; from_name: string | null; signature: string;
};
type Sent = { id: string; threadId: string; rfcId: string | null };
export type MailRunReport = { email: string; synced?: Record<string, number>; sent?: string | null; error?: string };
type Rpc = <T>(fn: string, args: Record<string, unknown>) => Promise<T>;

function workerDb(): Rpc {
  const secret = envValue("MAILER_SECRET");
  if (!secret || secret.length < 32) throw new Error("MAILER_SECRET is not set (32+ characters)");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, { secret, ...args });
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
}

const imapSettings = (a: Account): ImapSettings => ({
  email: a.email, password: decryptToken(a.token, a.email),
  imap_host: a.imap_host!, imap_port: a.imap_port!, smtp_host: a.smtp_host!, smtp_port: a.smtp_port!,
});
const sinceOf = (a: Account) => new Date(new Date(a.synced_until ?? Date.now() - 14 * 86400_000).getTime() - OVERLAP_MS);

/** Run for every connected inbox, or just one member's. */
export async function runMail(opts: { memberId?: string; send?: boolean } = {}): Promise<MailRunReport[]> {
  const rpc = workerDb();
  const accounts = await rpc<Account[]>("mailer_accounts", { p_member: opts.memberId ?? null });
  const reports: MailRunReport[] = [];
  for (const a of accounts) {
    const report: MailRunReport = { email: a.email };
    try {
      if (a.provider === "gmail") await runGmail(rpc, a, opts.send !== false, report);
      else if (a.provider === "imap") await runImap(rpc, a, opts.send !== false, report);
    } catch (e) {
      report.error = e instanceof Error ? e.message : String(e);
      await rpc("mailer_account_error", {
        p_account: a.id, p_error: report.error, p_needs_reconnect: e instanceof GoogleAuthError || e instanceof MailAuthError,
      }).catch(() => {});
    }
    reports.push(report);
  }
  return reports;
}

/** null when MAILER_SECRET opens the database's mail functions, else what's wrong. */
export async function mailerSecretProblem(): Promise<string | null> {
  try {
    await workerDb()("mailer_accounts", { p_member: "00000000-0000-0000-0000-000000000000" });
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return /not authorised/.test(msg)
      ? "MAILER_SECRET in Vercel doesn't match the database: run select mailer_set_secret('…') again with exactly the Vercel value"
      : msg;
  }
}

/** A member's own IMAP (GoDaddy) inboxes with their decrypted settings, for the live Mailbox page. */
export async function myImapInboxes(memberId: string) {
  const accounts = await workerDb()<Account[]>("mailer_accounts", { p_member: memberId });
  return accounts.filter((a) => a.provider === "imap").map((a) => ({ id: a.id, email: a.email, imapHost: a.imap_host!, settings: imapSettings(a) }));
}

/** Revoke a Gmail inbox's grant at Google (before disconnecting it in the database). */
export async function revokeInbox(memberId: string, accountId: string) {
  const rpc = workerDb();
  const a = (await rpc<Account[]>("mailer_accounts", { p_member: memberId })).find((x) => x.id === accountId);
  if (a?.provider === "gmail") await revokeToken(decryptToken(a.token, a.email)).catch(() => {});
}

const match = (rpc: Rpc, accountId: string) => (briefs: Brief[]) => rpc<string[]>("mailer_match", { p_account: accountId, p_msgs: briefs });
const save = (rpc: Rpc, accountId: string) => (msgs: SyncMessage[], cursor: string) =>
  rpc<Record<string, number>>("mailer_sync_save", { p_account: accountId, p_msgs: msgs, p_synced_until: cursor });

/** Claim the next due email for this inbox, send it with `send`, and record the result. */
async function sendNext(rpc: Rpc, accountId: string, send: (c: Claim) => Promise<Sent>, authError: (e: unknown) => boolean) {
  const c = await rpc<Claim | null>("mailer_claim", { p_account: accountId });
  if (!c) return null;
  try {
    const sent = await send(c);
    await rpc("mailer_result", {
      p_message: c.id, p_ok: true, p_gmail_id: sent.id, p_thread_id: sent.threadId, p_rfc_id: sent.rfcId, p_error: null,
    });
    return c.to;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await rpc("mailer_result", { p_message: c.id, p_ok: false, p_gmail_id: null, p_thread_id: null, p_rfc_id: null, p_error: msg });
    if (authError(e)) throw e;
    return null;
  }
}

// ---------- GoDaddy and other IMAP/SMTP inboxes ----------

async function runImap(rpc: Rpc, a: Account, send: boolean, report: MailRunReport) {
  const s = imapSettings(a);
  let c: ImapFlow | null = null;
  try {
    c = await openImap(s);
    report.synced = await syncImap(c, s, sinceOf(a), match(rpc, a.id), save(rpc, a.id));
    if (send) report.sent = await sendNext(rpc, a.id, (claim) => sendImap(c, s, claim), (e) => e instanceof MailAuthError);
  } finally {
    await c?.logout().catch(() => {});
  }
}

// ---------- Gmail ----------

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function runGmail(rpc: Rpc, a: Account, send: boolean, report: MailRunReport) {
  const access = await accessToken(decryptToken(a.token, a.email));
  report.synced = await syncGmail(rpc, a, access);
  if (send) {
    report.sent = await sendNext(rpc, a.id, async (c) => {
      const raw = buildRaw({
        from_email: c.from_email, from_name: c.from_name, to: c.to, to_name: c.to_name,
        subject: c.subject, body: c.body, signature: c.signature, in_reply_to: c.in_reply_to, references: c.references,
      });
      const sent = await sendRaw(access, raw, c.thread_id);
      const meta = await getMessage(access, sent.id, "metadata").catch(() => null);
      return { id: sent.id, threadId: sent.threadId, rfcId: meta ? header(meta, "Message-ID") : null };
    }, (e) => e instanceof GoogleAuthError);
  }
}

async function syncGmail(rpc: Rpc, a: Account, access: string) {
  const since = sinceOf(a);
  const startedAt = new Date();
  const { ids, more } = await listMessageIds(access, `after:${Math.floor(since.getTime() / 1000)}`, MAX_PER_SYNC);
  // Oldest first, so when there's more than one run's worth the cursor moves forward in order.
  const metas = await pool(ids.reverse(), 8, (m) => getMessage(access, m.id, "metadata"));

  // Ask the database which of these involve our leads (by address or by a thread we started).
  const brief = metas.map((m) => ({
    id: m.id, thread_id: m.threadId,
    from: addresses(header(m, "From"))[0] ?? "",
    to: [...addresses(header(m, "To")), ...addresses(header(m, "Cc"))],
  }));
  const matched = new Set(await match(rpc, a.id)(brief));
  // A bounce or reply in the same thread as a matched message belongs to it too.
  const threads = new Set(brief.filter((b) => matched.has(b.id)).map((b) => b.thread_id));
  const wanted = brief.filter((b) => matched.has(b.id) || threads.has(b.thread_id)).map((b) => b.id);

  // Only messages about leads are read in full and stored; everything else in the inbox is ignored.
  const full = await pool(wanted, 5, (id) => getMessage(access, id, "full"));
  const cursor = more && metas.length
    ? new Date(Math.max(...metas.map((m) => Number(m.internalDate ?? 0)))).toISOString()
    : startedAt.toISOString();
  return save(rpc, a.id)(full.map((m) => toSyncMessage(m, a.email)), cursor);
}
