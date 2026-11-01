// Building outgoing emails and reading synced Gmail messages. No app imports, so
// `node --test` can load it directly.

/** Added to every email that doesn't already carry an opt-out line (CAN-SPAM / CASL). */
export const OPT_OUT_LINE = 'Not interested? Reply "no" and I won\'t email again.';
const HAS_OPT_OUT = /reply\s+["“']?(no|stop|unsubscribe)["”']?/i;

/** The exact text that goes out: message, signature (name, postal address), opt-out line. */
export function composeText(body: string, signature: string | null | undefined) {
  const parts = [body.trim(), (signature ?? "").trim()].filter(Boolean);
  let text = parts.join("\n\n");
  if (!HAS_OPT_OUT.test(text)) text += `\n${OPT_OUT_LINE}`;
  return text.replace(/\r\n?/g, "\n");
}

const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
const isAscii = (v: string) => /^[\x20-\x7e]*$/.test(v);
/** RFC 2047 encoded-word for headers that aren't plain ASCII. */
const encodeHeader = (v: string) => (isAscii(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);
function mailbox(email: string, name?: string | null) {
  const addr = oneLine(email);
  if (!/^[^@\s<>"]+@[^@\s<>"]+$/.test(addr)) throw new Error(`invalid email address: ${addr}`);
  const n = name ? oneLine(name).replace(/"/g, "'") : "";
  return n ? `${isAscii(n) ? `"${n}"` : encodeHeader(n)} <${addr}>` : addr;
}

export type Outgoing = {
  from_email: string; from_name?: string | null;
  to: string; to_name?: string | null;
  subject: string; body: string; signature?: string | null;
  in_reply_to?: string | null; references?: string | null;
  /** Set for SMTP sends (Gmail adds its own): "<id@domain>" and the send time. */
  message_id?: string | null; date?: Date | null;
  /** One-click unsubscribe link (RFC 8058), for outreach. */
  unsubscribe_url?: string | null;
};

/** The full RFC 5322 message. Plain text only: no tracking, no HTML. */
export function buildMime(m: Outgoing): string {
  const headers = [
    `From: ${mailbox(m.from_email, m.from_name)}`,
    `To: ${mailbox(m.to, m.to_name)}`,
    `Subject: ${encodeHeader(oneLine(m.subject))}`,
  ];
  if (m.date) headers.push(`Date: ${m.date.toUTCString().replace("GMT", "+0000")}`);
  if (m.message_id) headers.push(`Message-ID: ${oneLine(m.message_id)}`);
  if (m.in_reply_to) headers.push(`In-Reply-To: ${oneLine(m.in_reply_to)}`);
  if (m.references || m.in_reply_to) headers.push(`References: ${oneLine(m.references || m.in_reply_to!)}`);
  if (m.unsubscribe_url) headers.push(`List-Unsubscribe: <${oneLine(m.unsubscribe_url)}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  headers.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64");
  const body = Buffer.from(composeText(m.body, m.signature).replace(/\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** The message as Gmail's `raw` field (base64url). */
export function buildRaw(m: Outgoing): string {
  return Buffer.from(buildMime(m), "utf8").toString("base64url");
}

// ---------- reading Gmail messages ----------

export type GmailPart = {
  mimeType?: string; filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart };

export function header(msg: GmailMessage, name: string): string | null {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

/** All addresses in a From/To/Cc header, lower-cased: '"Darin" <Darin@x.com>, b@y.com' -> ['darin@x.com', 'b@y.com']. */
export function addresses(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...value.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase());
}

const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");
export const htmlToText = (html: string) =>
  html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** The message's text: the text/plain part if there is one, else the HTML part as text. */
export function bodyText(part: GmailPart | undefined): string {
  if (!part) return "";
  const find = (p: GmailPart, type: string): GmailPart | null => {
    if (p.mimeType === type && p.body?.data && !p.filename) return p;
    for (const c of p.parts ?? []) { const hit = find(c, type); if (hit) return hit; }
    return null;
  };
  const plain = find(part, "text/plain");
  if (plain) return decode(plain.body?.data).replace(/\r\n?/g, "\n");
  const html = find(part, "text/html");
  return html ? htmlToText(decode(html.body?.data)).replace(/\r\n?/g, "\n") : "";
}

/** Just the new part of a reply: drops the quoted earlier messages below it. */
export function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const cut = lines.findIndex((l, i) =>
    /^\s*On .+wrote:\s*$/i.test(l) ||
    (/^\s*On .+/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? "")) ||
    /^-{2,}\s*Original Message\s*-{2,}/i.test(l) ||
    /^_{5,}\s*$/.test(l) ||
    (/^From:\s/i.test(l) && /^(Sent|Date):\s/i.test(lines[i + 1] ?? "")) ||
    /^>/.test(l));
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}

/** True when the whole reply is a plain request to stop ("no", "stop", "unsubscribe", "remove me"...). */
export function isOptOut(reply: string): boolean {
  const text = reply.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text || text.length > 120) return false;
  const first = text.split(/[\n.!,;:]/)[0].trim();
  return /^(no|nope|no thanks?|no thank you|stop|unsubscribe|remove|remove me|please remove me|take me off( your| the)? list|not interested|do not (contact|email) (me|us)( again)?|don't (contact|email) (me|us)( again)?)$/.test(first)
    || /\b(unsubscribe|remove me from|stop emailing|take me off)\b/.test(text);
}

export type SyncKind = "sent" | "reply" | "auto_reply" | "bounce";
export type SyncMessage = {
  id: string; thread_id: string; kind: SyncKind; from: string; to: string[]; subject: string | null; date: string;
  rfc_id: string | null; in_reply_to: string | null; snippet: string; body: string; unsubscribe: boolean; bounced_to: string | null;
};

type HeaderGet = (name: string) => string | null;

export function classifyBy(get: HeaderGet, mailbox: string, inSentFolder = false): SyncKind {
  const from = addresses(get("From"))[0] ?? "";
  if (from === mailbox.toLowerCase() || inSentFolder) return "sent";
  const subject = get("Subject") ?? "";
  if (/^(mailer-daemon|postmaster)@/i.test(from) || get("X-Failed-Recipients")) return "bounce";
  const auto = (get("Auto-Submitted") ?? "no").toLowerCase();
  if ((auto && auto !== "no") || get("X-Autoreply") || get("X-Autorespond")
      || /^(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|ooo\b)/i.test(subject)) return "auto_reply";
  return "reply";
}

export function classify(msg: GmailMessage, mailbox: string): SyncKind {
  return classifyBy((n) => header(msg, n), mailbox, !!msg.labelIds?.includes("SENT"));
}

/** Who a bounce was for: X-Failed-Recipients, else the delivery report's Final-Recipient. */
function bouncedTo(get: HeaderGet, text: string) {
  return addresses(get("X-Failed-Recipients"))[0]
    ?? addresses(text.match(/(?:Final|Original)-Recipient:\s*rfc822;\s*(\S+)/i)?.[1])[0]
    ?? null;
}

/** Any synced message, reduced to what the database stores. */
export function syncFrom(p: {
  id: string; thread_id: string; get: HeaderGet; text: string; date: Date; snippet?: string; mailbox: string; inSentFolder?: boolean;
}): SyncMessage {
  const kind = classifyBy(p.get, p.mailbox, p.inSentFolder);
  const reply = kind === "reply" || kind === "auto_reply" ? stripQuoted(p.text) : p.text;
  return {
    id: p.id,
    thread_id: p.thread_id,
    kind,
    from: addresses(p.get("From"))[0] ?? "",
    to: [...addresses(p.get("To")), ...addresses(p.get("Cc"))],
    subject: p.get("Subject"),
    date: p.date.toISOString(),
    rfc_id: p.get("Message-ID") ?? p.get("Message-Id"),
    in_reply_to: p.get("In-Reply-To"),
    snippet: (p.snippet ?? reply.replace(/\s+/g, " ")).slice(0, 300),
    body: reply.slice(0, 20000),
    unsubscribe: kind === "reply" && isOptOut(reply),
    bounced_to: kind === "bounce" ? bouncedTo(p.get, p.text) : null,
  };
}

/** A full Gmail message, reduced to what the database stores. */
export function toSyncMessage(msg: GmailMessage, mailbox: string): SyncMessage {
  return syncFrom({
    id: msg.id, thread_id: msg.threadId, get: (n) => header(msg, n), text: bodyText(msg.payload),
    date: new Date(Number(msg.internalDate ?? Date.now())), snippet: msg.snippet ?? "", mailbox,
    inSentFolder: !!msg.labelIds?.includes("SENT"),
  });
}

/**
 * IMAP has no thread ids, so a conversation is named after its first message: the first
 * id in References, else In-Reply-To, else the message's own Message-ID.
 */
export function imapThreadId(messageId: string | null | undefined, inReplyTo?: string | null, references?: string | string[] | null) {
  const refs = (Array.isArray(references) ? references.join(" ") : references ?? "").match(/<[^<>\s]+>/g) ?? [];
  const root = refs[0] ?? inReplyTo?.match(/<[^<>\s]+>/)?.[0] ?? messageId?.trim();
  return root ? `rfc:${root}` : null;
}
