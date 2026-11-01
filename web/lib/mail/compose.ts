// Writing email by hand from the Mailbox: addresses, reply/forward text, the checks
// before a send, and showing HTML email safely. No app imports, so `node --test` can
// load it directly.

import { OPT_OUT_LINE } from "./message.ts";

const ADDRESS = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]{2,}$/;
/** More than this many recipients is a mailing, and belongs in an outreach sequence. */
export const MAX_RECIPIENTS = 20;

/** "Darin <darin@x.com>, b@y.com; c@z.com" -> ["darin@x.com", "b@y.com", "c@z.com"]. Throws on anything that isn't an address. */
export function parseAddressList(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (value ?? "").split(/[,;\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const addr = (part.match(/<([^<>]+)>\s*$/)?.[1] ?? part).trim().toLowerCase();
    if (!ADDRESS.test(addr)) throw new Error(`"${part}" isn't an email address`);
    if (!out.includes(addr)) out.push(addr);
  }
  return out;
}

const stripPrefixes = (s: string) => s.replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, "").trim();
export const replySubject = (s: string) => `Re: ${stripPrefixes(s) || "(no subject)"}`;
export const forwardSubject = (s: string) => `Fwd: ${stripPrefixes(s) || "(no subject)"}`;

export type Original = {
  from: string; fromText: string; replyTo: string[]; to: string[]; cc: string[];
  subject: string; date: string | null; text: string; toText: string;
};

/** Who a reply goes to: the sender (or their Reply-To); "reply all" adds everyone else except me. */
export function replyRecipients(m: Original, me: string, all: boolean) {
  const mine = me.toLowerCase();
  const fromMe = m.from === mine;
  const to = fromMe ? m.to : m.replyTo.length ? m.replyTo : [m.from];
  const cc = all ? [...m.to, ...m.cc].filter((a) => a !== mine && !to.includes(a)) : [];
  return { to: [...new Set(to.filter((a) => a && a !== mine))], cc: [...new Set(cc)] };
}

const dateLine = (iso: string | null, tz: string) =>
  iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "";

/** The original message under a reply, each line quoted with "> ". */
export function quoteReply(m: Original, tz: string) {
  const head = `On ${dateLine(m.date, tz) || "an earlier date"}, ${m.fromText || m.from} wrote:`;
  return `${head}\n${m.text.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}`;
}

/** The original message under a forward. */
export function forwardBlock(m: Original, tz: string) {
  return [
    "---------- Forwarded message ----------",
    `From: ${m.fromText || m.from}`,
    m.date ? `Date: ${dateLine(m.date, tz)}` : null,
    `Subject: ${m.subject}`,
    m.toText ? `To: ${m.toText}` : null,
    "",
    m.text,
  ].filter((l) => l !== null).join("\n");
}

/** The text that goes out: message, signature, the opt-out line (cold email to a lead), then the quoted original. */
export function directText(p: { body: string; signature?: string | null; optOut?: boolean; quoted?: string | null }) {
  const parts = [p.body.trim(), (p.signature ?? "").trim()].filter(Boolean);
  let text = parts.join("\n\n");
  if (p.optOut && !/reply\s+["“']?(no|stop|unsubscribe)["”']?/i.test(text)) text += `\n${OPT_OUT_LINE}`;
  if (p.quoted?.trim()) text += `\n\n${p.quoted.trim()}`;
  return text.replace(/\r\n?/g, "\n");
}

// ---------- the checks before a hand-written email goes out ----------

export type RecipientContact = {
  email: string; do_not_contact: boolean; email_status: string | null; consent_basis: string | null;
  company: { name: string; country: string | null; stage: string | null } | null;
};
export type Suppression = { email: string | null; domain: string | null };
export type SendCheck = { problems: { email: string; reason: string }[]; optOut: boolean; leads: string[] };

const CASL_OK = ["casl_implied_published", "casl_implied_relationship", "express"];

/**
 * The same rules as the outreach queue, for one email written by hand. Anyone on the
 * never-contact list, marked do-not-contact or bounced is blocked. A new email (not a
 * reply) to a lead also needs a consent basis (and a CASL basis in Canada) and gets the
 * opt-out line; clients (won leads) and people who wrote to you first don't.
 */
export function checkRecipients(recipients: string[], contacts: RecipientContact[], suppressions: Suppression[], reply: boolean): SendCheck {
  const problems: SendCheck["problems"] = [];
  const leads = new Set<string>();
  let optOut = false;
  for (const email of recipients) {
    const domain = email.split("@")[1];
    const mine = contacts.filter((c) => c.email.toLowerCase() === email);
    for (const c of mine) if (c.company?.name) leads.add(c.company.name);
    const reason = (() => {
      if (suppressions.some((s) => s.email?.toLowerCase() === email || s.domain?.toLowerCase() === domain)) return "is on the never-contact list";
      if (mine.some((c) => c.do_not_contact)) return "is marked do-not-contact";
      if (mine.some((c) => c.email_status === "bounced" || c.email_status === "invalid")) return "bounced before or is invalid";
      if (reply) return null;
      for (const c of mine.filter((x) => x.company?.stage !== "won")) {
        if (!c.consent_basis || c.consent_basis === "unknown") return `has no consent basis on ${c.company?.name ?? "the lead"}: set one on the lead first`;
        if (c.company?.country === "CA" && !CASL_OK.includes(c.consent_basis)) return `is a Canadian contact without a CASL basis (${c.company.name})`;
      }
      return null;
    })();
    if (reason) problems.push({ email, reason });
    if (!reply && mine.some((c) => c.company?.stage !== "won")) optOut = true;
  }
  return { problems, optOut, leads: [...leads] };
}

// ---------- showing HTML email ----------

/**
 * A complete, inert document for a sandboxed <iframe srcdoc>: scripts, forms, frames
 * and meta/base tags are removed, a CSP allows no scripts or connections, links open in
 * a new tab, and remote images (tracking pixels) load only when asked for.
 */
export function emailDocument(html: string, opts: { images: boolean }) {
  const clean = html
    .replace(/<(script|noscript|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|iframe|frame|frameset|object|embed|applet|base|meta|link|form)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, "$1=\"#\"");
  const img = opts.images ? "img-src https: http: data:" : "img-src data:";
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${img}; style-src 'unsafe-inline'; font-src data:">`
    + `<base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#111;font:14px/1.5 system-ui,sans-serif;word-wrap:break-word}body{padding:4px}img{max-width:100%;height:auto}table{max-width:100%}</style>`
    + `</head><body>${clean}</body></html>`;
}

/** True when the HTML loads images from the internet (which would tell the sender you opened it). */
export const hasRemoteImages = (html: string) => /<img\b[^>]*\ssrc\s*=\s*["']?\s*https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
