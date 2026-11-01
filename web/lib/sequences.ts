// Sequences: the merge fields the database fills in (merge_template in migration
// 0010) and the checks on a step before it's saved. No app imports, so `node --test`
// can load it directly.

export const MERGE_FIELDS = [
  { tag: "{{first_name}}", help: "Contact's first name (\"there\" if unknown)" },
  { tag: "{{full_name}}", help: "Contact's full name" },
  { tag: "{{company}}", help: "Business name" },
  { tag: "{{city}}", help: "City (\"your area\" if unknown)" },
  { tag: "{{trade}}", help: "Trade, e.g. HVAC, roofing" },
  { tag: "{{website}}", help: "Their website" },
  { tag: "{{personal_line}}", help: "The research report's hook (left out if there's none)" },
  { tag: "{{my_name}}", help: "Your first name" },
] as const;

const KNOWN = new Set<string>(MERGE_FIELDS.map((f) => f.tag));

/** Merge fields that don't exist (typos like {{firstname}}), which would go out as-is. */
export function unknownFields(text: string): string[] {
  return [...new Set((text.match(/\{\{\s*[^{}]*\s*\}\}/g) ?? []).filter((t) => !KNOWN.has(t)))];
}

export type Step = { day: number; subject: string; body: string };

/** Problems with a sequence's steps, in plain words (empty when it's fine to save). */
export function stepProblems(steps: Step[]): string[] {
  const out: string[] = [];
  if (!steps.length) out.push("Add at least one step");
  if (steps.length > 8) out.push("Up to 8 steps");
  steps.forEach((s, i) => {
    const n = `Step ${i + 1}`;
    if (!Number.isInteger(s.day) || s.day < 1 || s.day > 90) out.push(`${n}: the day must be between 1 and 90`);
    if (i > 0 && s.day <= steps[i - 1].day) out.push(`${n}: its day must come after step ${i}'s`);
    if (i === 0 && !s.subject.trim()) out.push("Step 1 needs a subject");
    if (!s.body.trim()) out.push(`${n} needs a message`);
    for (const t of unknownFields(`${s.subject} ${s.body}`)) out.push(`${n}: ${t} isn't a merge field`);
  });
  return out;
}

/** What a step looks like for one sample lead (the same fallbacks as the database). */
export function previewMerge(text: string, v: Partial<Record<"first_name" | "full_name" | "company" | "city" | "trade" | "website" | "personal_line" | "my_name", string | null>>) {
  const fill: Record<string, string> = {
    first_name: v.first_name || "there", full_name: v.full_name || "there", company: v.company || "your company",
    city: v.city || "your area", trade: v.trade || "home service", website: v.website || "your website",
    personal_line: v.personal_line || "", my_name: v.my_name || "",
  };
  return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in fill ? fill[k] : m)).replace(/\n[ \t]*\n([ \t]*\n)+/g, "\n\n").trim();
}
