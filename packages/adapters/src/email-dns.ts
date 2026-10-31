import dns from "node:dns/promises";

/**
 * Mail servers for a domain, best first. Empty when the domain has none
 * (mail to it would bounce). Network errors are thrown, so a flaky
 * connection is never mistaken for "no mail server".
 */
export async function mxHosts(domain: string): Promise<string[]> {
  try {
    const recs = await dns.resolveMx(domain);
    return recs.sort((a, b) => a.priority - b.priority).map((r) => r.exchange).filter(Boolean);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ENOTIMP") return [];
    throw e;
  }
}
