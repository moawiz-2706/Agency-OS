// CSV in and out (RFC 4180: quoted fields may hold commas, quotes and line breaks).
// No app imports, so `node --test` can load it directly.

const needsQuotes = /[",\r\n]|^\s|\s$/;
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Rows as CSV text with a header row; CRLF line ends and a BOM so Excel reads UTF-8 correctly. */
export function toCsv(header: string[], rows: Record<string, unknown>[]) {
  return "﻿" + [header.map(cell).join(","), ...rows.map((r) => header.map((h) => cell(r[h])).join(","))].join("\r\n") + "\r\n";
}

/** CSV text to records keyed by the (trimmed, lower-cased) header. Blank lines are skipped. */
export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, "");
  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      table.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); table.push(row); }
  const lines = table.filter((r) => r.some((c) => c.trim() !== ""));
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((r) => Object.fromEntries(header.map((h, j) => [h, (r[j] ?? "").replace(/\r\n?/g, "\n")])));
  return { header, rows };
}
