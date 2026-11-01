// Turns a raw email from an IMAP inbox (GoDaddy etc.) into what the database stores.
// No server-only imports, so `node --test` can load it.
import { simpleParser } from "mailparser";
import { htmlToText, imapThreadId, syncFrom, type SyncMessage } from "./message.ts";

const unfold = (v: string) => v.replace(/\r?\n[ \t]+/g, " ").trim();

/** Headers of the original message quoted inside a bounce, so the bounce lands in its thread. */
function quotedOriginal(text: string) {
  const grab = (name: string) => text.match(new RegExp(`^${name}:\\s*((?:.*)(?:\\r?\\n[ \\t]+.*)*)`, "im"))?.[1];
  const messageId = grab("Message-ID")?.match(/<[^<>\s]+>/)?.[0];
  return messageId ? imapThreadId(messageId, grab("In-Reply-To"), grab("References") ? unfold(grab("References")!) : null) : null;
}

export async function imapToSync(source: Buffer | string, o: {
  id: string; mailbox: string; inSentFolder: boolean; internalDate?: Date | null;
}): Promise<SyncMessage> {
  const p = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
  const lines = new Map<string, string>();
  for (const h of p.headerLines) if (!lines.has(h.key)) lines.set(h.key, unfold(h.line.slice(h.line.indexOf(":") + 1)));
  const get = (name: string) => lines.get(name.toLowerCase()) ?? null;

  let text = p.text ?? (typeof p.html === "string" ? htmlToText(p.html) : "");
  // Delivery reports carry the failed address and the original headers as attachments.
  const report = p.attachments
    .filter((a) => /^(message\/delivery-status|message\/rfc822|text\/rfc822-headers|message\/rfc822-headers)$/i.test(a.contentType))
    .map((a) => a.content.toString("utf8")).join("\n");
  if (report) text = `${text}\n${report}`;

  const messageId = p.messageId ?? get("Message-ID");
  const own = imapThreadId(messageId, p.inReplyTo ?? null, p.references ?? null) ?? o.id;
  const msg = syncFrom({
    id: o.id, thread_id: own, get, text, date: p.date ?? o.internalDate ?? new Date(), mailbox: o.mailbox, inSentFolder: o.inSentFolder,
  });
  if (msg.kind === "bounce") {
    msg.thread_id = quotedOriginal(report || text) ?? own;
    msg.body = msg.body.slice(0, 4000);
  }
  return msg;
}
