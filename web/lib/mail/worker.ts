import "server-only";
import { createClient } from "@supabase/supabase-js";
import { decryptToken } from "./crypto";
import { GoogleAuthError, accessToken, getMessage, listMessageIds, revokeToken, sendRaw } from "./google";
import { addresses, buildRaw, header, toSyncMessage } from "./message";

// One run for each connected inbox: sync Gmail (your own sends, replies, bounces) into
// the CRM, then send at most one due, approved email. Runs every 5 minutes from
// pg_cron, and on demand ("Sync now", "Send now"). It has no service-role key:
// the database only lets it in with MAILER_SECRET, and only into mail functions.

const MAX_PER_SYNC = 300;          // messages looked at per inbox per run; the cursor catches up next run
const OVERLAP_MS = 10 * 60_000;    // re-read the last 10 minutes so nothing slips between runs

type Account = { id: string; member_id: string; email: string; from_name: string | null; token: string; synced_until: string | null };
type Claim = {
  id: string; to: string; to_name: string | null; subject: string; body: string; thread_id: string | null;
  in_reply_to: string | null; references: string | null; from_email: string; from_name: string | null; signature: string;
};
export type MailRunReport = { email: string; synced?: Record<string, number>; sent?: string | null; error?: string };

function workerDb() {
  const secret = process.env.MAILER_SECRET;
  if (!secret || secret.length < 32) throw new Error("MAILER_SECRET is not set (32+ characters)");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db.rpc(fn, { secret, ...args });
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  }
  return rpc;
}

/** Run for every connected inbox, or just one member's. */
export async function runMail(opts: { memberId?: string; send?: boolean } = {}): Promise<MailRunReport[]> {
  const rpc = workerDb();
  const accounts = await rpc<Account[]>("mailer_accounts", { p_member: opts.memberId ?? null });
  const reports: MailRunReport[] = [];
  for (const a of accounts) {
    const report: MailRunReport = { email: a.email };
    try {
      const access = await accessToken(decryptToken(a.token, a.email));
      report.synced = await syncInbox(rpc, a, access);
      if (opts.send !== false) report.sent = await sendNext(rpc, a.id, access);
    } catch (e) {
      report.error = e instanceof Error ? e.message : String(e);
      await rpc("mailer_account_error", {
        p_account: a.id, p_error: report.error, p_needs_reconnect: e instanceof GoogleAuthError,
      }).catch(() => {});
    }
    reports.push(report);
  }
  return reports;
}

/** Revoke a member's Gmail grant at Google (before disconnecting it in the database). */
export async function revokeMemberToken(memberId: string) {
  const rpc = workerDb();
  const [a] = await rpc<Account[]>("mailer_accounts", { p_member: memberId });
  if (a) await revokeToken(decryptToken(a.token, a.email)).catch(() => {});
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function syncInbox(rpc: ReturnType<typeof workerDb>, a: Account, access: string) {
  const since = new Date(new Date(a.synced_until ?? Date.now() - 14 * 86400_000).getTime() - OVERLAP_MS);
  const startedAt = new Date();
  const { ids, more } = await listMessageIds(access, `after:${Math.floor(since.getTime() / 1000)}`, MAX_PER_SYNC);
  // Oldest first, so when there's more than one run's worth the cursor moves forward in order.
  const batch = ids.reverse();
  const metas = await pool(batch, 8, (m) => getMessage(access, m.id, "metadata"));

  // Ask the database which of these involve our leads (by address or by a thread we started).
  const brief = metas.map((m) => ({
    id: m.id, thread_id: m.threadId,
    from: addresses(header(m, "From"))[0] ?? "",
    to: [...addresses(header(m, "To")), ...addresses(header(m, "Cc"))],
  }));
  const matched = new Set(await rpc<string[]>("mailer_match", { p_account: a.id, p_msgs: brief }));
  // A bounce or reply in the same thread as a matched message belongs to it too.
  const threads = new Set(brief.filter((b) => matched.has(b.id)).map((b) => b.thread_id));
  const wanted = brief.filter((b) => matched.has(b.id) || threads.has(b.thread_id)).map((b) => b.id);

  // Only messages about leads are read in full and stored; everything else in the inbox is ignored.
  const full = await pool(wanted, 5, (id) => getMessage(access, id, "full"));
  const cursor = more && metas.length
    ? new Date(Math.max(...metas.map((m) => Number(m.internalDate ?? 0)))).toISOString()
    : startedAt.toISOString();
  return rpc<Record<string, number>>("mailer_sync_save", {
    p_account: a.id, p_msgs: full.map((m) => toSyncMessage(m, a.email)), p_synced_until: cursor,
  });
}

async function sendNext(rpc: ReturnType<typeof workerDb>, accountId: string, access: string) {
  const c = await rpc<Claim | null>("mailer_claim", { p_account: accountId });
  if (!c) return null;
  try {
    const raw = buildRaw({
      from_email: c.from_email, from_name: c.from_name, to: c.to, to_name: c.to_name,
      subject: c.subject, body: c.body, signature: c.signature, in_reply_to: c.in_reply_to, references: c.references,
    });
    const sent = await sendRaw(access, raw, c.thread_id);
    const meta = await getMessage(access, sent.id, "metadata").catch(() => null);
    await rpc("mailer_result", {
      p_message: c.id, p_ok: true, p_gmail_id: sent.id, p_thread_id: sent.threadId,
      p_rfc_id: meta ? header(meta, "Message-ID") : null, p_error: null,
    });
    return c.to;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await rpc("mailer_result", { p_message: c.id, p_ok: false, p_gmail_id: null, p_thread_id: null, p_rfc_id: null, p_error: msg });
    if (e instanceof GoogleAuthError) throw e;
    return null;
  }
}
