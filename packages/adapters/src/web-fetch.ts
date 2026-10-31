import dns from "node:dns/promises";
import net from "node:net";

// SSRF-safe fetch for business websites: public IPs only, ports 80/443,
// 4 redirects max, 1.5 MB cap, 10 s timeout.

export type FetchOptions = { userAgent: string; timeoutMs?: number };

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http/https allowed");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("non-standard port blocked");
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error("host resolves to a private address");
  }
  return u;
}

const MAX_BYTES = 1_500_000;

export async function safeFetch(raw: string, { userAgent, timeoutMs = 10_000 }: FetchOptions) {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": userAgent, Accept: "text/html,*/*;q=0.5" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    // read with a size cap
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        chunks.push(value);
        if (size > MAX_BYTES) { await reader.cancel(); break; }
      }
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    return { status: res.status, finalUrl: url.toString(), text };
  }
  throw new Error("too many redirects");
}

/** Very small robots.txt check: skip if `User-agent: *` disallows `/`. */
export async function robotsAllows(siteUrl: string, opts: FetchOptions): Promise<boolean> {
  try {
    const u = new URL(siteUrl);
    const { status, text } = await safeFetch(`${u.protocol}//${u.host}/robots.txt`, { ...opts, timeoutMs: 5_000 });
    if (status >= 400) return true;
    let applies = false;
    for (const line of text.split(/\r?\n/)) {
      const [k, ...rest] = line.split(":");
      const key = k.trim().toLowerCase();
      const val = rest.join(":").trim();
      if (key === "user-agent") applies = val === "*";
      else if (applies && key === "disallow" && val === "/") return false;
    }
    return true;
  } catch {
    return true; // no robots.txt reachable -> default allow
  }
}
