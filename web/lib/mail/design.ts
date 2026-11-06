// How outreach emails look: the team's email design (migration 0014) turns the plain
// message + inbox signature into a clean HTML email, always with a plain-text copy.
// Cold email that reads like a personal note gets more replies (and lands in the inbox
// more often) than a newsletter, so there are no images, banners or buttons: just good
// type, a sign-off, a proper signature block and the opt-out line in small print.
// No imports, so it runs in the browser (the preview) and under `node --test`.

export type EmailStyle = "plain" | "personal" | "branded";
export type EmailFont = "sans" | "serif";
export type EmailDesign = { style: EmailStyle; accent: string; sign_off: string; font: EmailFont };

export const DEFAULT_DESIGN: EmailDesign = { style: "personal", accent: "#1d4ed8", sign_off: "Best regards,", font: "sans" };

export const STYLES: { key: EmailStyle; label: string; help: string }[] = [
  { key: "personal", label: "Personal (recommended)", help: "Looks like a well-written email from a person: clean text, a sign-off, a neat signature with your website. Best for replies." },
  { key: "branded", label: "Branded", help: "The same, with your company name and an accent bar in the signature. A little more polished, still no images." },
  { key: "plain", label: "Plain text", help: "Text only, exactly as typed. The most \"hand-written\" look, but no formatting at all." },
];

/** Added to every email that doesn't already carry an opt-out line (CAN-SPAM / CASL). */
export const OPT_OUT_LINE = 'Not interested? Reply "no" and I won\'t email again.';
const HAS_OPT_OUT = /reply\s+["“']?(no|stop|unsubscribe)["”']?/i;

/** The team's saved design, with anything missing or odd replaced by the default. */
export function normalizeDesign(v: unknown): EmailDesign {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const style = STYLES.some((s) => s.key === o.style) ? (o.style as EmailStyle) : DEFAULT_DESIGN.style;
  const accent = typeof o.accent === "string" && /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : DEFAULT_DESIGN.accent;
  const sign_off = typeof o.sign_off === "string" ? o.sign_off.replace(/[\r\n]+/g, " ").trim().slice(0, 60) : DEFAULT_DESIGN.sign_off;
  const font = o.font === "serif" ? "serif" : "sans";
  return { style, accent, sign_off, font };
}

const SIGN_OFF = /^(best|thanks|thank you|many thanks|cheers|regards|kind regards|best regards|warm regards|warmly|talk soon|speak soon|all the best|sincerely|yours)\b[\s\S]{0,20}$/i;

/** The message with the sign-off added, unless it already ends with one (or with the sender's name). */
export function withSignOff(body: string, signOff: string, signature: string | null | undefined) {
  const text = body.replace(/\r\n?/g, "\n").trim();
  if (!signOff.trim()) return text;
  const name = (signature ?? "").replace(/\r\n?/g, "\n").trim().split("\n")[0]?.trim().toLowerCase() ?? "";
  const first = name.split(/\s+/)[0] ?? "";
  const tail = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(-2);
  const signed = tail.some((l) => SIGN_OFF.test(l) || (first && (l.toLowerCase() === name || l.toLowerCase() === first || l.toLowerCase().replace(/[,.]$/, "") === first)));
  return signed ? text : `${text}\n\n${signOff.trim()}`;
}

/** The exact plain text that goes out: message, signature (name, postal address), opt-out line. */
export function composeText(body: string, signature: string | null | undefined) {
  const parts = [body.trim(), (signature ?? "").trim()].filter(Boolean);
  let text = parts.join("\n\n");
  if (!HAS_OPT_OUT.test(text)) text += `\n${OPT_OUT_LINE}`;
  return text.replace(/\r\n?/g, "\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;
const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

/** One line of text as HTML: escaped, links clickable, **bold** supported. */
function inline(line: string, accent: string, linkLabel: (url: string) => string = (u) => u) {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    out += esc(line.slice(last, m.index));
    out += `<a href="${esc(m[0])}" style="color:${accent};text-decoration:none;">${esc(linkLabel(m[0]))}</a>`;
    last = m.index! + m[0].length;
  }
  out += esc(line.slice(last));
  return out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** The message as HTML paragraphs; lines starting with "- " or "• " become a list. */
export function bodyToHtml(text: string, accent: string) {
  const blocks = text.replace(/\r\n?/g, "\n").trim().split(/\n[ \t]*\n+/);
  return blocks.map((b) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
      return `<ul style="margin:0 0 14px;padding-left:22px;">${lines.map((l) => `<li style="margin:0 0 4px;">${inline(l.replace(/^\s*[-•*]\s+/, ""), accent)}</li>`).join("")}</ul>`;
    }
    return `<p style="margin:0 0 14px;">${lines.map((l) => inline(l, accent)).join("<br>")}</p>`;
  }).join("\n");
}

/** The inbox signature as a neat block: name in bold, links tidy, the small print in grey. */
export function signatureHtml(signature: string, d: EmailDesign) {
  const lines = signature.replace(/\r\n?/g, "\n").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  const [name, ...rest] = lines;
  const row = (l: string) => {
    const hasUrl = new RegExp(URL_RE.source).test(l);
    const parts = l.split(/\s+\|\s+/);
    const html = parts.map((p, i) => {
      // "The Sentinel Systems | https://…": the company name links to the site too.
      const url = parts.find((x) => new RegExp(`^${URL_RE.source}$`).test(x));
      if (i === 0 && url && p !== url && d.style === "branded") return `<a href="${esc(url)}" style="color:${d.accent};text-decoration:none;font-weight:bold;">${esc(p)}</a>`;
      return inline(p, d.accent, host);
    }).join(` <span style="color:#d1d5db;">|</span> `);
    return `<div style="${hasUrl ? "color:#374151;" : "color:#6b7280;"}font-size:13px;line-height:1.5;">${html}</div>`;
  };
  const nameHtml = `<div style="color:#111827;font-weight:bold;font-size:15px;line-height:1.5;">${esc(name)}</div>`;
  const inner = nameHtml + rest.map(row).join("");
  if (d.style === "branded") {
    return `<div style="margin-top:6px;padding:2px 0 2px 12px;border-left:3px solid ${d.accent};">${inner}</div>`;
  }
  return `<div style="margin-top:6px;">${inner}</div>`;
}

const FONTS: Record<EmailFont, string> = {
  sans: "Arial,Helvetica,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
};

export type Rendered = { text: string; html: string | null };

/**
 * What goes out for one email. `plain` (or no design: before migration 0014) keeps the
 * old text-only email. Otherwise the HTML and the text say exactly the same thing.
 */
export function renderEmail(body: string, signature: string | null | undefined, design: EmailDesign | null | undefined): Rendered {
  if (!design || design.style === "plain") return { text: composeText(body, signature), html: null };
  const message = withSignOff(body, design.sign_off, signature);
  const text = composeText(message, signature);
  const sig = (signature ?? "").trim();
  const optOut = HAS_OPT_OUT.test(`${message}\n${sig}`) ? "" : OPT_OUT_LINE;
  const html = [
    // No color-scheme meta: mail apps then adapt the colours for dark mode themselves.
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>",
    `<body style="margin:0;padding:0;"><div style="font-family:${FONTS[design.font]};font-size:15px;line-height:1.6;color:#1f2937;max-width:600px;">`,
    bodyToHtml(message, design.accent),
    sig ? signatureHtml(sig, design) : "",
    optOut ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#9ca3af;">${esc(optOut)}</p>` : "",
    "</div></body></html>",
  ].join("\n");
  return { text, html };
}
