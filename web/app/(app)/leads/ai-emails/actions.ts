"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { parseCsv } from "@/lib/csv";
import { checkImport, schedule, type PlannedEmail } from "@/lib/ai-emails";
import { importIndex, researchedLeads } from "@/lib/ai-emails-data";

// Importing the outside AI's emails. "Check" reads the files and says what would happen;
// "Import" does the same checks again and saves every email as a draft waiting for
// approval (queue_email: from my inbox, consent and never-contact checks included).

export type AiImportResult = {
  ok: boolean; error?: string; imported?: number;
  leads: number; emails: number; problems: string[];
  sample: { company: string; email: string; step: number; send_day: number; subject: string; body: string }[];
};

const MAX_BYTES = 3 * 1024 * 1024;

async function readFiles(form: FormData) {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error("Choose the CSV file(s) the AI gave you");
  if (files.reduce((t, f) => t + f.size, 0) > MAX_BYTES) throw new Error("The files are over 3 MB in total: split them and import in parts");
  const header = new Set<string>();
  const rows: Record<string, string>[] = [];
  for (const f of files) {
    const text = await f.text();
    const parsed = parseCsv(text.replace(/^\s*```[a-z]*\s*\n/i, "").replace(/\n```\s*$/, ""));   // AIs sometimes wrap it in ``` fences
    parsed.header.forEach((h) => header.add(h));
    rows.push(...parsed.rows);
  }
  if (!rows.length) throw new Error("No email rows found in the file");
  return { header: [...header], rows };
}

async function check(form: FormData) {
  const supabase = await supabaseServer();
  const { header, rows } = await readFiles(form);
  const leads = await researchedLeads(supabase);
  return { supabase, result: checkImport(header, rows, importIndex(leads)) };
}

const summary = (r: ReturnType<typeof checkImport>): Omit<AiImportResult, "ok"> => ({
  leads: r.leads, emails: r.emails.length, problems: r.problems.slice(0, 50),
  sample: r.emails.slice(0, 6).map(({ company, email, step, send_day, subject, body }) => ({ company, email, step, send_day, subject, body })),
});
const fail = (e: unknown): AiImportResult => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong", leads: 0, emails: 0, problems: [], sample: [] });

export async function checkAiEmails(form: FormData): Promise<AiImportResult> {
  try {
    const { result } = await check(form);
    return { ok: true, ...summary(result) };
  } catch (e) {
    return fail(e);
  }
}

export async function importAiEmails(form: FormData): Promise<AiImportResult> {
  try {
    const { supabase, result } = await check(form);
    if (!result.emails.length) return { ok: false, error: "Nothing to import: fix the problems listed and try again", ...summary(result) };
    const start = String(form.get("start") ?? "");
    const time = String(form.get("time") ?? "08:00");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("Pick the day the first emails go out");
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Pick a send time");
    const when = schedule(result.emails, start, time, form.get("skip_weekends") === "on");
    const account = String(form.get("from_account") ?? "auto");

    // Leads in parallel (a few at a time); each lead's steps in order, so they number 1, 2, 3...
    const byLead = new Map<string, PlannedEmail[]>();
    for (const e of result.emails) byLead.set(e.company_id, [...(byLead.get(e.company_id) ?? []), e]);
    const queue = [...byLead.values()];
    let imported = 0;
    const problems = [...result.problems];
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let list = queue.shift(); list; list = queue.shift()) {
        for (const e of list.sort((a, b) => a.step - b.step)) {
          const { error } = await supabase.rpc("queue_email", {
            p_company: e.company_id, p_contact: e.contact_id, p_subject: e.subject, p_body: e.body, p_scheduled_for: when.get(e),
            p_approve: false, p_account: account === "auto" ? null : account,
          });
          if (error) { problems.push(`${e.company} step ${e.step}: ${error.message}`); break; }
          imported++;
        }
      }
    }));
    revalidatePath("/inbox");
    revalidatePath("/leads", "layout");
    return { ok: true, imported, ...summary(result), problems: problems.slice(0, 50) };
  } catch (e) {
    return fail(e);
  }
}
