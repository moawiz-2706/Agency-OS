// The website's contact form: reading and checking a submission before it becomes a
// lead. No app imports, so `node --test` can load it directly.

export type ContactForm = { name: string; email: string; company: string; website: string; tools: string; pain: string; page: string };
export type FormCheck = { ok: true; form: ContactForm } | { ok: false; error: string } | { ok: "spam" };

const MIN_SECONDS = 3;   // people take longer than this to fill it in; bots don't
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");

/**
 * `data` is the posted fields. Two traps for bots: `company_url` must stay empty (the
 * field is hidden from people), and `started` (ms timestamp set when the form appeared)
 * must be at least a few seconds old. A bot gets "spam": answer it as if it worked.
 */
export function checkContactForm(data: Record<string, unknown>, now = Date.now()): FormCheck {
  if (text(data.company_url, 500)) return { ok: "spam" };
  const started = Number(data.started);
  if (Number.isFinite(started) && started > 0 && now - started < MIN_SECONDS * 1000) return { ok: "spam" };
  const form: ContactForm = {
    name: text(data.name, 200), email: text(data.email, 200).toLowerCase(), company: text(data.company, 200),
    website: text(data.website, 300), tools: text(data.tools, 1000), pain: text(data.pain, 3000), page: text(data.page, 500),
  };
  if (!form.name) return { ok: false, error: "Please enter your name." };
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]{2,}$/.test(form.email)) return { ok: false, error: "Please enter a valid email address." };
  if (form.website && !/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(form.website)) {
    return { ok: false, error: "Please check the website address (e.g. yourcompany.com)." };
  }
  return { ok: true, form };
}

/** Which website origins may post the form from the browser (FORM_ORIGINS, comma-separated). */
export function allowedOrigins(env: string | undefined) {
  const list = (env ?? "https://thesentinelsystems.com,https://www.thesentinelsystems.com").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  return new Set(list);
}
