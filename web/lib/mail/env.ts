import "server-only";

// Mail settings from the server environment. Values are cleaned the forgiving way,
// because the setup commands print "NAME=value" and it's easy to paste the whole line
// (or quotes, or a trailing space) into Vercel.

export function envValue(name: string): string | null {
  let v = process.env[name]?.trim();
  if (!v) return null;
  if (v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
  v = v.replace(/^["']|["']$/g, "").trim();
  return v || null;
}

/**
 * The public address of the app, used for the Gmail redirect. APP_URL wins when set
 * (e.g. https://agencyos.thesentinelsystems.com); otherwise the address the request came in on.
 */
export function appOrigin(h: Headers): string {
  const fixed = envValue("APP_URL");
  if (fixed) return fixed.replace(/\/+$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}

export const gmailRedirectUri = (h: Headers) => `${appOrigin(h)}/auth/gmail/callback`;
