// "AI email drafts": researched leads go out as a CSV with a prompt for an outside AI
// (Claude, ChatGPT, Manus); the AI's CSV of emails comes back and becomes drafts
// waiting for approval. This file builds the prompt and checks the AI's file. No app
// imports, so `node --test` can load it directly.
import { zonedLocalToIso } from "./tz.ts";

// ---------- what goes out ----------

export const EXPORT_COLUMNS = [
  "lead_id", "company", "trade", "city", "state", "country", "website", "google_rating", "google_reviews",
  "contact_name", "contact_role", "contact_email", "score", "research_summary", "issues_found", "personal_hook",
  "recommended_offer", "other_offers", "call_questions",
] as const;

export const OUTPUT_COLUMNS = ["lead_id", "contact_email", "step", "send_day", "subject", "body"] as const;

export type PromptOptions = { emails: number; days: number[]; senderName: string; agency: string; offers: Record<string, string> };

/** The instructions for the outside AI. It must return exactly OUTPUT_COLUMNS. */
export function buildPrompt(o: PromptOptions) {
  const days = o.days.slice(0, o.emails);
  const offers = Object.entries(o.offers).map(([k, v]) => `- \`${k}\`: ${v}`).join("\n");
  return `# Write cold email sequences for researched leads

You are writing outreach emails for **${o.agency}**, a small automation agency (built on GoHighLevel) that helps
US and Canadian home-service businesses (HVAC, plumbing, roofing, garage doors, restoration…) stop losing jobs:
missed-call text-back, instant replies to web leads, online booking, review requests and a simple pipeline.
The emails go out from ${o.senderName}'s own inbox, one person writing to one business owner.

## Input
The attached CSV (\`researched-leads-….csv\`) has one row per lead. Use every column, especially:
- \`issues_found\`: problems we verified on their website / Google profile, each with an evidence link. These are your material.
- \`personal_hook\`: an opening line from the research. Use it (or something equally specific) in email 1.
- \`recommended_offer\`: what to pitch. The offers are:
${offers}
- \`contact_name\`: if it's empty, open with "Hi there," (never invent a name).

## What to write
For **every** lead, write a sequence of **${days.length} emails**, sent on days **${days.join(", ")}**:
1. **Email 1:** a specific observation about their business (from \`issues_found\` / \`personal_hook\`), what it likely costs them
   (missed calls, slow replies, lost bookings…), the one fix we'd set up, and a low-pressure question (e.g. "worth a 15-minute look?").
${days.length > 1 ? `2. **Follow-ups (emails 2–${days.length}):** each adds something new: a different angle from their issues, a short result
   ("a roofing client booked 6 extra jobs in month one from missed-call texts"), or a simpler ask. The last one is a polite
   "should I close the loop?" note.` : ""}

## Rules
- Plain text only. **No links, no images, no attachments**, no tracking. Email 1 under 120 words, follow-ups under 80.
- **No signature, no sign-off name, no unsubscribe line.** We add the signature, postal address and opt-out line ourselves.
- Only use facts from the CSV. Never invent numbers, reviews, competitors or names. If an issue isn't in the CSV, don't mention it.
- Sound like a person: short sentences, no hype, no "I hope this email finds you well", no exclamation marks, no emojis.
- Subject lines: 2–6 words, lower case, specific to them (e.g. "missed calls at swift?"). Leave the subject **empty** for
  follow-ups: they're sent as replies in the same thread.
- No placeholders like [Name] or {{company}}: every email must be ready to send as written.
- Use "you/your" and the business name naturally. Don't mention that you researched them with AI.

## Output format (important)
Return **one CSV file** (UTF-8) named \`ai-emails.csv\`, and nothing else, with exactly this header row:

\`\`\`
${OUTPUT_COLUMNS.join(",")}
\`\`\`

- One row per email: ${days.length} rows per lead, \`step\` 1 to ${days.length}.
- \`lead_id\` and \`contact_email\`: copied exactly from the input row.
- \`send_day\`: the day number above (${days.join(", ")}).
- \`subject\`: only on step 1; empty for later steps.
- \`body\`: the email text. Put the whole body in double quotes; line breaks inside the quotes are fine; write any
  double quote inside the text as two double quotes ("").

Example (one lead, two of its rows):

\`\`\`
${OUTPUT_COLUMNS.join(",")}
6f1c…,darin@swift.example,1,${days[0]},missed calls at swift?,"Hi Darin,

Saw that your website's estimate form doesn't send…

Worth a 15-minute look?"
6f1c…,darin@swift.example,2,${days[1] ?? days[0] + 3},,"Hi Darin, quick follow-up…"
\`\`\`

If the file is long, you may split it into several CSV files with the same header.
`;
}

// ---------- what comes back ----------

export type ImportLead = {
  company_id: string; name: string; lead_ref: string | null; time_zone: string;
  contacts: { id: string; email: string }[];
  /** Why this lead can't get these emails (e.g. it already has emails waiting), or null. */
  blocked: string | null;
};
export type PlannedEmail = {
  company_id: string; company: string; contact_id: string; email: string; time_zone: string;
  step: number; send_day: number; subject: string; body: string;
};
export type ImportCheck = { emails: PlannedEmail[]; leads: number; problems: string[] };

const PLACEHOLDER = /\{\{[^}]*\}\}|\[(first ?name|name|company|business|your name|city|insert[^\]]*|owner)\]/i;

/** Read the AI's rows, match them to leads, and keep only complete, clean sequences. */
export function checkImport(header: string[], rows: Record<string, string>[], leads: ImportLead[]): ImportCheck {
  const missing = OUTPUT_COLUMNS.filter((c) => c !== "send_day" && c !== "contact_email" && !header.includes(c));
  if (missing.length) return { emails: [], leads: 0, problems: [`The file is missing the column(s): ${missing.join(", ")}. The header must be: ${OUTPUT_COLUMNS.join(",")}`] };

  const byId = new Map<string, ImportLead>();
  const byEmail = new Map<string, ImportLead>();
  for (const l of leads) {
    byId.set(l.company_id.toLowerCase(), l);
    if (l.lead_ref) byId.set(l.lead_ref.toLowerCase(), l);
    for (const c of l.contacts) byEmail.set(c.email.toLowerCase(), l);
  }

  const problems: string[] = [];
  const groups = new Map<string, { lead: ImportLead; rows: { line: number; r: Record<string, string> }[] }>();
  rows.forEach((r, i) => {
    const line = i + 2;
    const email = (r.contact_email ?? "").trim().toLowerCase();
    const lead = byId.get((r.lead_id ?? "").trim().toLowerCase()) ?? (email ? byEmail.get(email) : undefined);
    if (!lead) { problems.push(`Row ${line}: lead "${r.lead_id || email || "?"}" isn't one of the exported leads`); return; }
    const g = groups.get(lead.company_id) ?? { lead, rows: [] };
    g.rows.push({ line, r });
    groups.set(lead.company_id, g);
  });

  const emails: PlannedEmail[] = [];
  let okLeads = 0;
  for (const { lead, rows: lrows } of groups.values()) {
    const bad: string[] = [];
    if (lead.blocked) bad.push(lead.blocked);
    const email = (lrows.find((x) => x.r.contact_email?.trim())?.r.contact_email ?? "").trim().toLowerCase();
    const contact = lead.contacts.find((c) => c.email.toLowerCase() === email) ?? (email ? undefined : lead.contacts[0]);
    if (!contact) bad.push(email ? `${email} isn't an emailable contact on this lead` : "no emailable contact");
    const parsed = lrows.map(({ line, r }) => ({
      line, step: Number(r.step), send_day: Number(r.send_day || NaN), subject: (r.subject ?? "").replace(/[\r\n]+/g, " ").trim(),
      body: (r.body ?? "").trim(),
    })).sort((a, b) => a.step - b.step);
    const steps = parsed.map((p) => p.step);
    if (steps.some((s) => !Number.isInteger(s) || s < 1 || s > 8)) bad.push("step must be 1 to 8");
    if (new Set(steps).size !== steps.length) bad.push("the same step appears twice");
    if (steps[0] !== 1) bad.push("there's no step 1");
    if (!parsed[0]?.subject) bad.push("step 1 has no subject");
    for (const p of parsed) {
      if (!p.body) bad.push(`step ${p.step} has no message`);
      if (p.body.length > 5000) bad.push(`step ${p.step} is too long`);
      if (PLACEHOLDER.test(`${p.subject} ${p.body}`)) bad.push(`step ${p.step} still has a placeholder like [Name] or {{company}}`);
    }
    parsed.forEach((p, i) => {
      if (!Number.isInteger(p.send_day)) p.send_day = i === 0 ? 1 : parsed[i - 1].send_day + 3;
      if (p.send_day < 1 || p.send_day > 90) bad.push(`step ${p.step}: send_day must be 1 to 90`);
      if (i > 0 && p.send_day <= parsed[i - 1].send_day) bad.push(`step ${p.step} must be sent after step ${parsed[i - 1].step}`);
    });
    if (bad.length) {
      problems.push(`${lead.name} (row${lrows.length > 1 ? "s" : ""} ${lrows.map((x) => x.line).join(", ")}): ${[...new Set(bad)].join("; ")}. Skipped.`);
      continue;
    }
    okLeads++;
    const first = parsed[0].subject;
    for (const p of parsed) {
      emails.push({
        company_id: lead.company_id, company: lead.name, contact_id: contact!.id, email: contact!.email, time_zone: lead.time_zone,
        step: p.step, send_day: p.send_day,
        subject: p.step === parsed[0].step ? first : p.subject && !/^re:/i.test(p.subject) ? p.subject : `Re: ${first.replace(/^re:\s*/i, "")}`,
        body: p.body,
      });
    }
  }
  return { emails, leads: okLeads, problems };
}

/**
 * When each email goes out: day 1 is `start` (lead-local), at `time` in the lead's time zone,
 * off weekends if asked. If day 1's time has already passed there, everything moves a day later.
 */
export function schedule(emails: PlannedEmail[], start: string, time: string, skipWeekends: boolean, now = new Date()) {
  const at = (date: Date, tz: string) => zonedLocalToIso(`${date.toISOString().slice(0, 10)}T${time}`, tz)!;
  const byLead = new Map<string, PlannedEmail[]>();
  for (const e of emails) byLead.set(e.company_id, [...(byLead.get(e.company_id) ?? []), e]);
  const out = new Map<PlannedEmail, string>();
  for (const list of byLead.values()) {
    const tz = list[0].time_zone;
    const firstDay = Math.min(...list.map((e) => e.send_day));
    const base = new Date(`${start}T00:00:00Z`);
    while (new Date(at(base, tz)) < now) base.setUTCDate(base.getUTCDate() + 1);
    for (const e of list) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + (e.send_day - firstDay));
      while (skipWeekends && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) d.setUTCDate(d.getUTCDate() + 1);
      out.set(e, at(d, tz));
    }
  }
  return out;
}
