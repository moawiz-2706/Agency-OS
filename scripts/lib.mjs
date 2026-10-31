// Shared bits for the admin scripts. They run on your PC with the service-role
// key from .env, so they bypass RLS; never ship them to the browser.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env"), quiet: true });

export function env(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    console.error(`Missing ${name} in .env (see .env.example).`);
    process.exit(1);
  }
  return v;
}

export function admin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

/** All rows of a select, 1000 at a time (PostgREST's page size). */
export async function selectAll(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await query().range(from, from + 999));
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** RFC 4180 CSV: quoted fields, "" escapes, newlines inside quotes, BOM. Returns objects keyed by header. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  const [headers, ...data] = rows;
  const keys = headers.map((h) => h.trim());
  return { headers: keys, records: data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()]))) };
}

export const chunk = (xs, n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
