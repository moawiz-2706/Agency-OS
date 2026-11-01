import "server-only";
import { tokenKey } from "./crypto.ts";
import { envValue, gmailRedirectUri } from "./env.ts";
import { mailerSecretProblem } from "./worker.ts";

export type SetupCheck = { label: string; ok: boolean; detail: string };

/** What the email setup on the server looks like. Never includes a secret value. */
export async function mailSetupCheck(h: Headers): Promise<SetupCheck[]> {
  const clientId = envValue("GOOGLE_CLIENT_ID");
  const checks: SetupCheck[] = [];

  let keyOk = true;
  try { tokenKey(); } catch { keyOk = false; }
  checks.push({ label: "MAIL_TOKEN_KEY", ok: keyOk,
    detail: keyOk ? "set (encrypts passwords and tokens)" : "missing or not 32 bytes of base64: generate it again and paste only the part after =" });

  const mailer = envValue("MAILER_SECRET") ? await mailerSecretProblem() : "not set in Vercel";
  checks.push({ label: "MAILER_SECRET", ok: !mailer, detail: mailer ?? "set and matches the database" });

  const cron = envValue("CRON_SECRET");
  checks.push({ label: "CRON_SECRET", ok: !!cron && cron.length >= 32, detail: cron ? "set (the 5-minute timer must send the same value)" : "not set in Vercel" });

  const idOk = !!clientId && /\.apps\.googleusercontent\.com$/.test(clientId);
  checks.push({ label: "GOOGLE_CLIENT_ID", ok: idOk,
    detail: idOk ? `${clientId} (must be the "AgencyOS Gmail" client, not the login one)` : clientId ? `"${clientId.slice(0, 12)}…" doesn't look like a client ID (…apps.googleusercontent.com)` : "not set in Vercel (only needed for Gmail)" });
  checks.push({ label: "GOOGLE_CLIENT_SECRET", ok: !!envValue("GOOGLE_CLIENT_SECRET"), detail: envValue("GOOGLE_CLIENT_SECRET") ? "set" : "not set in Vercel (only needed for Gmail)" });

  checks.push({ label: "Gmail redirect URI", ok: true,
    detail: `${gmailRedirectUri(h)}: add exactly this under Authorized redirect URIs of that Google client` });
  return checks;
}
