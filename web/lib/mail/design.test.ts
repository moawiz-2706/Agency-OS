import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DESIGN, OPT_OUT_LINE, bodyToHtml, normalizeDesign, renderEmail, withSignOff } from "./design.ts";
import { buildMime } from "./message.ts";
import { LIBRARY, SAMPLE_LEAD } from "../email-library.ts";
import { previewMerge, stepProblems } from "../sequences.ts";

const SIG = "Moawiz Bin Ammar\nThe Sentinel Systems | https://thesentinelsystems.com\nWe help home-service businesses.\n+44 777 8600314\nElderfield Road, Greater Manchester, BL3 4FU";

test("normalizeDesign keeps good values and replaces bad ones", () => {
  assert.deepEqual(normalizeDesign(null), DEFAULT_DESIGN);
  assert.deepEqual(normalizeDesign({ style: "branded", accent: "#0F766E", sign_off: "Thanks,\nx", font: "serif" }),
    { style: "branded", accent: "#0F766E", sign_off: "Thanks, x", font: "serif" });
  assert.deepEqual(normalizeDesign({ style: "loud", accent: "red;}", font: "comic" }), { ...DEFAULT_DESIGN });
});

test("the sign-off is added once, and not when the email already ends with one or with the sender's name", () => {
  assert.equal(withSignOff("Hi Mike,\n\nWorth a look?", "Best regards,", SIG), "Hi Mike,\n\nWorth a look?\n\nBest regards,");
  assert.equal(withSignOff("Hi Mike,\n\nWorth a look?\n\nThanks,", "Best regards,", SIG), "Hi Mike,\n\nWorth a look?\n\nThanks,");
  assert.equal(withSignOff("Hi Mike,\n\nWorth a look?\n\nMoawiz", "Best regards,", SIG), "Hi Mike,\n\nWorth a look?\n\nMoawiz");
  assert.equal(withSignOff("Hi", "", SIG), "Hi");
});

test("plain style (or no design) is the old text-only email", () => {
  for (const d of [null, { ...DEFAULT_DESIGN, style: "plain" as const }]) {
    const r = renderEmail("Hi Mike,\n\nQuick note.", SIG, d);
    assert.equal(r.html, null);
    assert.ok(r.text.startsWith("Hi Mike,\n\nQuick note.\n\nMoawiz Bin Ammar"));
    assert.ok(r.text.endsWith(OPT_OUT_LINE));
  }
});

test("the HTML version escapes the text, links URLs, makes lists and carries the opt-out line", () => {
  const r = renderEmail("Hi <Mike> & co,\n\n- one\n- two\n\nSee https://example.com/x.", SIG, DEFAULT_DESIGN);
  assert.ok(r.html);
  assert.match(r.html!, /Hi &lt;Mike&gt; &amp; co,/);
  assert.match(r.html!, /<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/);
  assert.match(r.html!, /<a href="https:\/\/example.com\/x"[^>]*>https:\/\/example.com\/x<\/a>\./);
  assert.match(r.html!, />thesentinelsystems\.com<\/a>/);            // signature link shows the bare domain
  assert.match(r.html!, /<strong>|font-weight:bold/);
  assert.ok(r.html!.includes("Not interested? Reply &quot;no&quot;"));
  assert.match(r.text, /Best regards,\n\nMoawiz Bin Ammar/);          // the text copy says the same thing
  assert.doesNotMatch(r.html!, /<img|<script/i);
});

test("bodyToHtml keeps single line breaks", () => {
  assert.equal(bodyToHtml("a\nb", "#000000"), '<p style="margin:0 0 14px;">a<br>b</p>');
});

test("with a design the MIME message is multipart/alternative, text first", () => {
  const mime = buildMime({ from_email: "a@b.test", to: "mike@x.test", subject: "Hi", body: "Hi Mike", signature: SIG, design: DEFAULT_DESIGN });
  const boundary = mime.match(/boundary="([^"]+)"/)![1];
  const parts = mime.split(`--${boundary}`);
  assert.equal(parts.length, 4);                                        // preamble, text, html, closing
  assert.match(parts[1], /Content-Type: text\/plain/);
  assert.match(parts[2], /Content-Type: text\/html/);
  assert.ok(parts[3].startsWith("--"));
  const html = Buffer.from(parts[2].split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(html, /Hi Mike/);
  assert.doesNotMatch(buildMime({ from_email: "a@b.test", to: "mike@x.test", subject: "Hi", body: "Hi" }), /multipart/);
});

test("every library sequence is valid and fits the templates table (max 4 steps)", () => {
  assert.ok(LIBRARY.length >= 5);
  assert.equal(new Set(LIBRARY.map((t) => t.key)).size, LIBRARY.length);
  for (const t of LIBRARY) {
    assert.deepEqual(stepProblems(t.steps), [], t.key);
    assert.ok(t.steps.length <= 4, t.key);
    assert.ok(t.steps.slice(1).every((s) => !s.subject), `${t.key}: follow-ups stay in the thread`);
    assert.doesNotMatch(t.steps.map((s) => s.body).join(" "), /https?:\/\//, `${t.key}: no links in the body`);
    for (const s of t.steps) {
      const words = previewMerge(s.body, SAMPLE_LEAD).split(/\s+/).length;
      assert.ok(words <= 140, `${t.key} day ${s.day}: ${words} words`);
    }
  }
});

test("the marketing design: header, one button, footer links, and the same words in the text part", async () => {
  const { renderMarketing, DEFAULT_MARKETING, normalizeMarketing } = await import("./design.ts");
  const r = renderMarketing("Hi Mike,\n\nHere's what we can help with:\n- Missed calls\n- Booking", SIG, DEFAULT_MARKETING,
    { sign_off: "Best regards,", booking_url: "https://cal.test/book", from_email: "moawiz@x.test", unsubscribe_url: "https://app.test/u?x=1" });
  assert.match(r.html!, /THE SENTINEL SYSTEMS/);
  assert.equal((r.html!.match(/href="https:\/\/cal.test\/book"/g) ?? []).length, 1, "one button");
  assert.ok(r.html!.indexOf("cal.test/book") < r.html!.indexOf("Best regards,"), "button sits above the sign-off");
  assert.match(r.html!, /mailto:moawiz@x.test/);
  assert.match(r.html!, /href="https:\/\/app.test\/u\?x=1"[^>]*>Unsubscribe/);
  assert.match(r.text, /Book a free consultation: https:\/\/cal.test\/book\n\nBest regards,\n\nMoawiz Bin Ammar/);
  assert.ok(r.text.endsWith(OPT_OUT_LINE));
  // No booking link set: the button falls back to the website in the signature.
  assert.match(renderMarketing("Hi", SIG, DEFAULT_MARKETING).html!, /href="https:\/\/thesentinelsystems.com"[^>]*>Book a free/);
  assert.equal(normalizeMarketing({ cta_url: "http://insecure.test", header: "" }).cta_url, null);
  assert.equal(normalizeMarketing({ header: "" }).header, DEFAULT_MARKETING.header);
});

test("with marketing set, the MIME message uses it", () => {
  const mime = buildMime({ from_email: "a@b.test", to: "mike@x.test", subject: "Hi", body: "Hi Mike", signature: SIG, design: DEFAULT_DESIGN,
    marketing: { design: { header: "ACME", tagline: "", cta_text: "Book", cta_url: "https://cal.test", accent: "#000000" } } });
  const parts = mime.split(/--=_sentinel_\w+/);
  const html = Buffer.from(parts[2].split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(html, /ACME/);
});
