import "server-only";
import { envValue } from "./env.ts";

// Google OAuth and the few Gmail API calls AgencyOS needs, over plain fetch.
// Scopes: send mail, read mail (to sync replies), and the address itself. Nothing
// that can delete or change mail.

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

/** Cookie holding the OAuth state between /auth/gmail/connect and the callback (CSRF check). */
export const STATE_COOKIE = "gmail_oauth_state";

/** Google said the refresh token is no good (revoked, expired, password changed): reconnect. */
export class GoogleAuthError extends Error {}

function client() {
  const id = envValue("GOOGLE_CLIENT_ID"), secret = envValue("GOOGLE_CLIENT_SECRET");
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  return { id, secret };
}

export function authUrl(redirectUri: string, state: string, loginHint?: string | null) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",            // always return a refresh token
    include_granted_scopes: "false",
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const { id, secret } = client();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new GoogleAuthError("Google access expired or was revoked: reconnect Gmail");
    throw new Error(`Google token error: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json as { access_token: string; refresh_token?: string; id_token?: string; scope?: string; expires_in: number };
}

/** Exchange the OAuth code. Returns the refresh token and the verified mailbox address. */
export async function exchangeCode(code: string, redirectUri: string) {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const granted = new Set((t.scope ?? "").split(" "));
  const missing = GMAIL_SCOPES.filter((s) => s.startsWith("https://") && !granted.has(s));
  if (missing.length) throw new Error("Please allow The Sentinel Systems to both send and read Gmail (tick every box on Google's screen)");
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token; try connecting again");
  // The ID token comes straight from Google's token endpoint over TLS, so its claims can be read without re-verifying.
  const claims = JSON.parse(Buffer.from((t.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8") || "{}");
  if (!claims.email || claims.email_verified === false) throw new Error("Google didn't share a verified email address");
  return { refreshToken: t.refresh_token, email: String(claims.email).toLowerCase() };
}

export async function accessToken(refreshToken: string) {
  return (await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" })).access_token;
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", cache: "no-store" }).catch(() => {});
}

async function gmail<T>(access: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new GoogleAuthError("Gmail rejected the access token: reconnect Gmail");
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${json.error?.message ?? res.statusText}`);
  return json as T;
}

/** Message ids (newest first) matching a Gmail search, up to `max`. */
export async function listMessageIds(access: string, q: string, max: number) {
  const out: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmail<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(
      access, `messages?${new URLSearchParams({ q, maxResults: "500", ...(pageToken ? { pageToken } : {}) })}`);
    out.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < max);
  return { ids: out.slice(0, max), more: Boolean(pageToken) || out.length > max };
}

const META_HEADERS = ["From", "To", "Cc", "Subject", "Message-ID", "In-Reply-To", "Auto-Submitted", "X-Autoreply", "X-Failed-Recipients"];

export function getMessage(access: string, id: string, format: "metadata" | "full") {
  const q = new URLSearchParams({ format });
  if (format === "metadata") META_HEADERS.forEach((h) => q.append("metadataHeaders", h));
  return gmail<import("./message").GmailMessage>(access, `messages/${id}?${q}`);
}

export function sendRaw(access: string, raw: string, threadId?: string | null) {
  return gmail<{ id: string; threadId: string }>(access, "messages/send", {
    method: "POST",
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });
}
