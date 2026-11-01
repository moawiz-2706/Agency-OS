// Run: npm test (from web/). The Mailbox's hand-written email: addresses, replies, checks, HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRecipients, directText, emailDocument, forwardBlock, hasRemoteImages, parseAddressList, quoteReply,
  replyRecipients, replySubject, forwardSubject, type RecipientContact,
} from "./compose.ts";
import { OPT_OUT_LINE } from "./message.ts";

test("address lists accept names, commas, semicolons and lines, and reject junk", () => {
  assert.deepEqual(parseAddressList('Darin Jenks <Darin@Swift.test>, b@y.co; \n c@z.org, b@y.co'), ["darin@swift.test", "b@y.co", "c@z.org"]);
  assert.deepEqual(parseAddressList("  "), []);
  assert.throws(() => parseAddressList("darin@swift"), /isn't an email address/);
  assert.throws(() => parseAddressList("a@b.com\r\nBcc: x@y.com"), /isn't an email address/);
});

const original = {
  from: "darin@swift.test", fromText: "Darin <darin@swift.test>", replyTo: [], to: ["moawiz@sentinel.test", "ops@swift.test"],
  cc: ["boss@swift.test"], toText: "moawiz@sentinel.test, ops@swift.test", subject: "RE: Re: Missed calls",
  date: "2026-11-02T15:00:00.000Z", text: "Sounds good.\n\nDarin",
};

test("reply goes to the sender (or Reply-To); reply all adds everyone but me", () => {
  assert.deepEqual(replyRecipients(original, "Moawiz@Sentinel.test", false), { to: ["darin@swift.test"], cc: [] });
  assert.deepEqual(replyRecipients(original, "moawiz@sentinel.test", true), { to: ["darin@swift.test"], cc: ["ops@swift.test", "boss@swift.test"] });
  assert.deepEqual(replyRecipients({ ...original, replyTo: ["help@swift.test"] }, "moawiz@sentinel.test", false).to, ["help@swift.test"]);
  // Replying to my own sent email goes to the people I sent it to.
  const mine = { ...original, from: "moawiz@sentinel.test", to: ["darin@swift.test"], cc: [] };
  assert.deepEqual(replyRecipients(mine, "moawiz@sentinel.test", false).to, ["darin@swift.test"]);
});

test("subjects and quoted text", () => {
  assert.equal(replySubject(original.subject), "Re: Missed calls");
  assert.equal(forwardSubject("Fwd: quote"), "Fwd: quote");
  assert.match(quoteReply(original, "America/Chicago"), /^On Nov 2, 2026, 9:00 AM, Darin <darin@swift\.test> wrote:\n> Sounds good\.\n>\n> Darin$/);
  assert.match(forwardBlock(original, "UTC"), /Forwarded message[\s\S]*From: Darin <darin@swift\.test>[\s\S]*Subject: RE: Re: Missed calls\n[\s\S]*\n\nSounds good\./);
});

test("the text that goes out: signature, the opt-out line only when asked, the quote last", () => {
  assert.equal(directText({ body: "Hi\r\n", signature: "Moawiz\n123 Main St" }), "Hi\n\nMoawiz\n123 Main St");
  assert.equal(directText({ body: "Hi", signature: "M", optOut: true, quoted: "> old" }), `Hi\n\nM\n${OPT_OUT_LINE}\n\n> old`);
  assert.equal(directText({ body: 'Hi, reply "stop" anytime', optOut: true }), 'Hi, reply "stop" anytime');
});

const lead = (over: Partial<RecipientContact> & { stage?: string; country?: string } = {}): RecipientContact => ({
  email: "darin@swift.test", do_not_contact: false, email_status: "valid", consent_basis: "can_spam_b2b",
  company: { name: "Swift Restoration", country: over.country ?? "US", stage: over.stage ?? "contacted" }, ...over,
});

test("hand-written email follows the never-contact list and the consent rules", () => {
  const ok = checkRecipients(["darin@swift.test", "friend@else.test"], [lead()], [], false);
  assert.deepEqual(ok, { problems: [], optOut: true, leads: ["Swift Restoration"] });
  // Not a lead at all: nothing to check, no opt-out line.
  assert.deepEqual(checkRecipients(["friend@else.test"], [], [], false), { problems: [], optOut: false, leads: [] });

  const blocked = (c: RecipientContact[], s = [] as { email: string | null; domain: string | null }[], reply = false) =>
    checkRecipients(["darin@swift.test"], c, s, reply).problems.map((p) => p.reason);
  assert.match(blocked([], [{ email: null, domain: "SWIFT.test" }])[0], /never-contact/);
  assert.match(blocked([lead({ do_not_contact: true })], [], true)[0], /do-not-contact/);
  assert.match(blocked([lead({ email_status: "bounced" })])[0], /bounced/);
  assert.match(blocked([lead({ consent_basis: "unknown" })])[0], /no consent basis/);
  assert.match(blocked([lead({ consent_basis: "can_spam_b2b", country: "CA" })])[0], /CASL/);
  // They wrote first (a reply), or they're a client: no consent basis needed, no opt-out line.
  assert.deepEqual(checkRecipients(["darin@swift.test"], [lead({ consent_basis: "unknown" })], [], true), { problems: [], optOut: false, leads: ["Swift Restoration"] });
  assert.deepEqual(checkRecipients(["darin@swift.test"], [lead({ consent_basis: "unknown", stage: "won" })], [], false).problems, []);
});

test("HTML email is shown inert: no scripts, handlers, forms or remote images unless asked", () => {
  const html = `<p onclick="steal()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>
    <form action="https://evil.test"><input></form><meta http-equiv="refresh" content="0;url=https://evil.test"><img src="https://t.test/p.gif">`;
  const doc = emailDocument(html, { images: false });
  assert.doesNotMatch(doc, /<script|onclick|javascript:|<form|refresh/i);
  assert.match(doc, /default-src 'none'; img-src data:;/);
  assert.match(emailDocument(html, { images: true }), /img-src https: http: data:/);
  assert.equal(hasRemoteImages(html), true);
  assert.equal(hasRemoteImages('<img src="data:image/png;base64,AA">'), false);
});
