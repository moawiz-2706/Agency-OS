// Run: npm test (from web/). Node strips the types itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptToken, encryptToken } from "./crypto.ts";
import { OPT_OUT_LINE, buildRaw, composeText, isOptOut, stripQuoted, toSyncMessage, type GmailMessage } from "./message.ts";
import { leadTimeZone, zonedLocalToIso } from "../tz.ts";

const key = randomBytes(32);
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

test("tokens round-trip and are bound to their mailbox", () => {
  const sealed = encryptToken("1//refresh-token", "Owner@Gmail.com", key);
  assert.match(sealed, /^v1\./);
  assert.equal(decryptToken(sealed, "owner@gmail.com", key), "1//refresh-token");
  assert.throws(() => decryptToken(sealed, "someone@else.com", key));
  assert.throws(() => decryptToken(sealed, "owner@gmail.com", randomBytes(32)));
  const [v, iv, tag, ct] = sealed.split(".");
  assert.throws(() => decryptToken([v, iv, tag, ct.slice(0, -2) + "AA"].join("."), "owner@gmail.com", key));
});

test("every email gets the signature and exactly one opt-out line", () => {
  const text = composeText("Hi Darin,\r\n\r\nQuick note.", "Moawiz\n123 Main St");
  assert.equal(text, `Hi Darin,\n\nQuick note.\n\nMoawiz\n123 Main St\n${OPT_OUT_LINE}`);
  const own = composeText("Hi", 'Moawiz\nNot interested? Reply "no" and I won\'t email again.');
  assert.equal(own.match(/Reply "no"/g)?.length, 1);
});

test("buildRaw makes a plain-text reply that can't be header-injected", () => {
  const raw = buildRaw({
    from_email: "owner@gmail.com", from_name: "Moawiz", to: "darin@swift.test", to_name: "Darin Jenks",
    subject: "Re: Two numbers\r\nBcc: victim@x.com", body: "Hi Darin — quick idea", signature: "Moawiz\nAddress",
    in_reply_to: "<m1@mail.gmail.com>", references: "<m0@x> <m1@mail.gmail.com>",
  });
  const msg = Buffer.from(raw, "base64url").toString("utf8");
  const [head, body] = msg.split("\r\n\r\n");
  assert.match(head, /^From: "Moawiz" <owner@gmail\.com>\r\nTo: "Darin Jenks" <darin@swift\.test>\r\n/);
  assert.match(head, /Subject: Re: Two numbers Bcc: victim@x\.com\r\n/);
  assert.doesNotMatch(head, /^Bcc:/m);
  assert.match(head, /In-Reply-To: <m1@mail\.gmail\.com>\r\nReferences: <m0@x> <m1@mail\.gmail\.com>/);
  const text = Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(text, /^Hi Darin — quick idea\r\n\r\nMoawiz\r\nAddress\r\nNot interested/);
  assert.throws(() => buildRaw({ from_email: "a@b.co", to: "x@y.co>\r\nBcc: z@q.co", subject: "s", body: "b" }));
});

test("replies: quoted history is dropped and only clear opt-outs count", () => {
  assert.equal(stripQuoted("Sounds good, call me.\n\nOn Wed, Nov 4, 2026 at 7:45 AM Moawiz <o@g.com> wrote:\n> Hi Darin"), "Sounds good, call me.");
  assert.equal(stripQuoted("Thanks!\nOn Wed, Nov 4, 2026 at 7:45 AM Moawiz <o@g.com>\nwrote:\n> hi"), "Thanks!");
  for (const yes of ["no", "No.", "STOP", "unsubscribe", "Please remove me", "not interested, thanks", "Take me off your list"]) {
    assert.equal(isOptOut(yes), true, yes);
  }
  for (const no of ["No problem, can you call me Tuesday?", "Not now, maybe in spring", "Who is this?", ""]) {
    assert.equal(isOptOut(no), false, no);
  }
});

const gm = (headers: Record<string, string>, text: string, extra: Partial<GmailMessage> = {}): GmailMessage => ({
  id: "g1", threadId: "t1", internalDate: String(Date.UTC(2026, 10, 4, 14, 45)), snippet: text.slice(0, 50),
  payload: { mimeType: "multipart/alternative", headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    parts: [{ mimeType: "text/html", body: { data: b64u(`<p>${text}</p>`) } }, { mimeType: "text/plain", body: { data: b64u(text) } }] },
  ...extra,
});

test("synced messages are classified as sent, reply, auto-reply or bounce", () => {
  const reply = toSyncMessage(gm({ From: '"Darin" <Darin@Swift.test>', To: "Owner@gmail.com", Subject: "Re: Two numbers", "Message-ID": "<r1@x>" },
    "no\n\nOn Wed, Nov 4, 2026 Moawiz wrote:\n> Hi"), "owner@gmail.com");
  assert.deepEqual([reply.kind, reply.from, reply.body, reply.unsubscribe, reply.rfc_id, reply.date],
    ["reply", "darin@swift.test", "no", true, "<r1@x>", "2026-11-04T14:45:00.000Z"]);

  const sent = toSyncMessage(gm({ From: "Moawiz <owner@gmail.com>", To: "a@x.test, B@y.test", Cc: "c@z.test", Subject: "Hi" }, "Hello"), "owner@gmail.com");
  assert.deepEqual([sent.kind, sent.to], ["sent", ["a@x.test", "b@y.test", "c@z.test"]]);

  const ooo = toSyncMessage(gm({ From: "darin@swift.test", Subject: "Automatic reply: Two numbers", "Auto-Submitted": "auto-replied" }, "Away"), "owner@gmail.com");
  assert.deepEqual([ooo.kind, ooo.unsubscribe], ["auto_reply", false]);

  const bounce = toSyncMessage(gm({ From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "X-Failed-Recipients": "old@swift.test", Subject: "Delivery Status Notification (Failure)" }, "not found"), "owner@gmail.com");
  assert.deepEqual([bounce.kind, bounce.bounced_to], ["bounce", "old@swift.test"]);
});

test("send times are read in the lead's own time zone", () => {
  assert.equal(leadTimeZone({ region: "ut" }), "America/Denver");
  assert.equal(leadTimeZone({ time_zone: "America/New_York", region: "TN" }), "America/New_York");
  assert.equal(leadTimeZone({ time_zone: "Not/AZone", region: "AZ" }), "America/Phoenix");
  assert.equal(leadTimeZone({ region: null }), "America/New_York");
  // 7:45 AM in Utah on 4 Nov 2026 (MST, UTC-7) = 14:45 UTC = 7:45 PM in Pakistan.
  assert.equal(zonedLocalToIso("2026-11-04T07:45", "America/Denver"), "2026-11-04T14:45:00.000Z");
  // Daylight saving: 31 Oct 2026 is still MDT (UTC-6).
  assert.equal(zonedLocalToIso("2026-10-31T07:45", "America/Denver"), "2026-10-31T13:45:00.000Z");
});

test("GoDaddy (IMAP) messages: replies join our thread, bounces find the failed email", async () => {
  const { imapToSync } = await import("./imap-parse.ts");
  const { buildMime, imapThreadId } = await import("./message.ts");
  const ours = buildMime({ from_email: "moawiz@sentinel.test", from_name: "Moawiz", to: "darin@swift.test", subject: "Two numbers",
    body: "Hi Darin", signature: "Moawiz\nAddress", message_id: "<a1@sentinel.test>", date: new Date("2026-11-04T14:45:00Z") });
  assert.match(ours, /\r\nDate: Wed, 04 Nov 2026 14:45:00 \+0000\r\nMessage-ID: <a1@sentinel\.test>\r\n/);
  assert.equal(imapThreadId("<a2@x>", "<a1@sentinel.test>", "<a1@sentinel.test> <a2@x>"), "rfc:<a1@sentinel.test>");

  const sent = await imapToSync(ours, { id: "rfc:<a1@sentinel.test>", mailbox: "moawiz@sentinel.test", inSentFolder: true });
  assert.deepEqual([sent.kind, sent.thread_id, sent.to], ["sent", "rfc:<a1@sentinel.test>", ["darin@swift.test"]]);

  const reply = [
    "From: Darin <darin@swift.test>", "To: moawiz@sentinel.test", "Subject: Re: Two numbers",
    "Message-ID: <r1@swift.test>", "In-Reply-To: <a1@sentinel.test>", "References: <a1@sentinel.test>",
    "Date: Thu, 05 Nov 2026 15:00:00 +0000", "Content-Type: text/plain; charset=utf-8", "",
    "Sounds good, call me.", "", "On Wed, Nov 4, 2026 Moawiz wrote:", "> Hi Darin", "",
  ].join("\r\n");
  const r = await imapToSync(reply, { id: "rfc:<r1@swift.test>", mailbox: "moawiz@sentinel.test", inSentFolder: false });
  assert.deepEqual([r.kind, r.thread_id, r.body, r.rfc_id, r.date], ["reply", "rfc:<a1@sentinel.test>", "Sounds good, call me.", "<r1@swift.test>", "2026-11-05T15:00:00.000Z"]);

  const bounce = [
    "From: Mail Delivery System <MAILER-DAEMON@secureserver.net>", "To: moawiz@sentinel.test", "Subject: Undelivered Mail Returned to Sender",
    "Message-ID: <b1@secureserver.net>", "MIME-Version: 1.0", 'Content-Type: multipart/report; report-type=delivery-status; boundary="XX"', "",
    "--XX", "Content-Type: text/plain", "", "Your message could not be delivered.", "",
    "--XX", "Content-Type: message/delivery-status", "", "Reporting-MTA: dns; p3plibsmtp.secureserver.net", "",
    "Final-Recipient: rfc822; old@swift.test", "Action: failed", "Status: 5.1.1", "",
    "--XX", "Content-Type: text/rfc822-headers", "", "From: moawiz@sentinel.test", "To: old@swift.test", "Subject: Hello",
    "Message-ID: <a9@sentinel.test>", "", "--XX--", "",
  ].join("\r\n");
  const b = await imapToSync(bounce, { id: "rfc:<b1@secureserver.net>", mailbox: "moawiz@sentinel.test", inSentFolder: false });
  assert.deepEqual([b.kind, b.bounced_to, b.thread_id], ["bounce", "old@swift.test", "rfc:<a9@sentinel.test>"]);
});
