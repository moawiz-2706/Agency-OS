import dns from "node:dns/promises";
import net from "node:net";
import { USER_AGENT } from "./config.js";

export type WebsiteSignals = {
  reachable: boolean;
  https: boolean;
  mobile_viewport: boolean;
  has_form: boolean;
  has_online_booking: boolean;
  booking_tools: string[];
  has_chat_widget: boolean;
  chat_tools: string[];
  has_sms_cta: boolean;
  has_review_widget: boolean;
  has_ad_pixel: boolean;
  ad_pixels: string[];
  uses_ghl: boolean;          // already on GoHighLevel / LeadConnector
  emails_found: string[];     // published on their own site (CASL-relevant)
  title: string | null;
};

// ---------- SSRF-safe fetch ----------

function isPrivateIp(ip: string): boolean {
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

export async function safeFetch(raw: string, timeoutMs = 10_000) {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.5" },
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
export async function robotsAllows(siteUrl: string): Promise<boolean> {
  try {
    const u = new URL(siteUrl);
    const { status, text } = await safeFetch(`${u.protocol}//${u.host}/robots.txt`, 5_000);
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

// ---------- signal detection ----------

const BOOKING: Record<string, RegExp> = {
  calendly: /calendly\.com/,
  housecall_pro: /housecallpro\.com/,
  servicetitan: /servicetitan/,
  jobber: /getjobber\.com|jobber\.com/,
  acuity: /acuityscheduling\.com/,
  setmore: /setmore\.com/,
  square_appointments: /squareup\.com\/appointments/,
  generic_cta: /book (?:online|now|a service|an appointment)|schedule (?:online|service|now)|request (?:an )?appointment/,
};

const CHAT: Record<string, RegExp> = {
  podium: /podium\.com/,
  birdeye: /birdeye\.com/,
  tawk: /tawk\.to/,
  intercom: /intercom(?:cdn)?\.(?:io|com)/,
  drift: /drift\.com|js\.driftt\.com/,
  livechat: /livechatinc\.com/,
  tidio: /tidio(?:chat)?\.co/,
  hubspot: /js\.hs-scripts\.com|js\.usemessages\.com/,
  crisp: /crisp\.chat/,
  zendesk: /zdassets\.com/,
  leadconnector_chat: /widgets\.leadconnectorhq\.com/,
};

const PIXELS: Record<string, RegExp> = {
  meta_pixel: /connect\.facebook\.net\/[^"']*fbevents|fbq\(/,
  google_ads: /googleadservices\.com|gtag\(\s*['"]config['"]\s*,\s*['"]aw-/,
  tiktok: /analytics\.tiktok\.com/,
  bing_ads: /bat\.bing\.com/,
};

const IGNORE_EMAIL = /\.(png|jpe?g|gif|svg|webp)$|example\.com|sentry|wixpress|domain\.com/;

export function detectSignals(html: string, finalUrl: string): WebsiteSignals {
  const h = html.toLowerCase();
  const hits = (m: Record<string, RegExp>) => Object.keys(m).filter((k) => m[k].test(h));
  const booking = hits(BOOKING);
  const chat = hits(CHAT);
  const pixels = hits(PIXELS);
  const emails = [
    ...new Set(
      (html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
        .map((e) => e.toLowerCase())
        .filter((e) => !IGNORE_EMAIL.test(e)),
    ),
  ].slice(0, 5);

  return {
    reachable: true,
    https: finalUrl.startsWith("https://"),
    mobile_viewport: /<meta[^>]+name=["']viewport["']/.test(h),
    has_form: /<form[\s>]/.test(h),
    has_online_booking: booking.length > 0,
    booking_tools: booking,
    has_chat_widget: chat.length > 0,
    chat_tools: chat,
    has_sms_cta: /href=["']sms:|text us/.test(h),
    has_review_widget: /birdeye|podium|nicejob|grade\.us|reviewsonmywebsite|elfsight/.test(h),
    has_ad_pixel: pixels.length > 0,
    ad_pixels: pixels,
    uses_ghl: /leadconnectorhq\.com|msgsndr\.com|gohighlevel/.test(h),
    emails_found: emails,
    title: html.match(/<title[^>]*>([^<]{0,200})/i)?.[1]?.trim() ?? null,
  };
}

export async function auditWebsite(url: string) {
  if (!(await robotsAllows(url))) {
    return { ok: false as const, error: "robots.txt disallows crawling", status: null, finalUrl: url };
  }
  try {
    const r = await safeFetch(url);
    if (r.status >= 400) return { ok: false as const, error: `HTTP ${r.status}`, status: r.status, finalUrl: r.finalUrl };
    return { ok: true as const, status: r.status, finalUrl: r.finalUrl, signals: detectSignals(r.text, r.finalUrl) };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message, status: null, finalUrl: url };
  }
}
