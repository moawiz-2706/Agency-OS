// Unsubscribe links. Each link carries the address and a signature (HMAC with a key
// derived from MAIL_TOKEN_KEY), so nobody can unsubscribe someone else by editing the
// URL. No app imports, so `node --test` can load it directly.
import { createHmac, timingSafeEqual } from "node:crypto";
import { tokenKey } from "./crypto.ts";

const sign = (email: string, key: Buffer) =>
  createHmac("sha256", createHmac("sha256", key).update("agencyos-unsubscribe-v1").digest())
    .update(email.toLowerCase()).digest("base64url").slice(0, 32);

/** The one-click link for List-Unsubscribe (and the page it opens). */
export function unsubscribeUrl(origin: string, email: string, key = tokenKey()) {
  const q = new URLSearchParams({ e: Buffer.from(email.toLowerCase(), "utf8").toString("base64url"), t: sign(email, key) });
  return `${origin.replace(/\/+$/, "")}/api/unsubscribe?${q}`;
}

/** The address a link is for, or null when it's been tampered with. */
export function verifyUnsubscribe(e: string | null, t: string | null, key = tokenKey()): string | null {
  if (!e || !t) return null;
  const email = Buffer.from(e, "base64url").toString("utf8").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const want = Buffer.from(sign(email, key));
  const got = Buffer.from(t);
  return want.length === got.length && timingSafeEqual(want, got) ? email : null;
}
