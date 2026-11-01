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
};

/** RFC 5322 message as Gmail's `raw` field (base64url). Plain text only: no tracking, no HTML. */
export function buildRaw(m: Outgoing): string {
  const headers = [
    `From: ${mailbox(m.from_email, m.from_name)}`,
    `To: ${mailbox(m.to, m.to_name)}`,
    `Subject: ${encodeHeader(oneLine(m.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (m.in_reply_to) headers.push(`In-Reply-To: ${oneLine(m.in_reply_to)}`);
  if (m.references || m.in_reply_to) headers.push(`References: ${oneLine(m.references || m.in_reply_to!)}`);
  const body = Buffer.from(composeText(m.body, m.signature).replace(/\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
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
const htmlToText = (html: string) =>
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

export function classify(msg: GmailMessage, mailbox: string): SyncKind {
  const from = addresses(header(msg, "From"))[0] ?? "";
  if (from === mailbox.toLowerCase() || msg.labelIds?.includes("SENT")) return "sent";
  const subject = header(msg, "Subject") ?? "";
  if (/^(mailer-daemon|postmaster)@/i.test(from) || header(msg, "X-Failed-Recipients")) return "bounce";
  const auto = (header(msg, "Auto-Submitted") ?? "no").toLowerCase();
  if ((auto && auto !== "no") || header(msg, "X-Autoreply") || header(msg, "X-Autorespond")
      || /^(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|ooo\b)/i.test(subject)) return "auto_reply";
  return "reply";
}

/** A full Gmail message, reduced to what the database stores. */
export function toSyncMessage(msg: GmailMessage, mailbox: string): SyncMessage {
  const kind = classify(msg, mailbox);
  const text = bodyText(msg.payload);
  const reply = kind === "reply" || kind === "auto_reply" ? stripQuoted(text) : text;
  return {
    id: msg.id,
    thread_id: msg.threadId,
    kind,
    from: addresses(header(msg, "From"))[0] ?? "",
    to: [...addresses(header(msg, "To")), ...addresses(header(msg, "Cc"))],
    subject: header(msg, "Subject"),
    date: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
    rfc_id: header(msg, "Message-ID") ?? header(msg, "Message-Id"),
    in_reply_to: header(msg, "In-Reply-To"),
    snippet: (msg.snippet ?? "").slice(0, 300),
    body: reply.slice(0, 20000),
    unsubscribe: kind === "reply" && isOptOut(reply),
    bounced_to: kind === "bounce" ? addresses(header(msg, "X-Failed-Recipients"))[0] ?? null : null,
  };
}
