import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Read a required env var. The app entry point loads .env before anything calls this. */
export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. Add it to agencyos/.env`);
  return v;
}

let client: SupabaseClient | null = null;

/** Server-side client using the service-role key. Never ship this key to a browser. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export type Actor = "claude" | "user" | "system";

export async function logActivity(companyId: string | null, type: string, payload: object = {}, actor: Actor = "claude") {
  const { error } = await db().from("activities").insert({ company_id: companyId, type, payload, actor });
  if (error) console.error("activity log failed:", error.message);
}

/** One insert for many rows, e.g. a CSV import. */
export async function logActivities(rows: { company_id: string | null; type: string; payload?: object; actor?: Actor }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ payload: {}, actor: "claude", ...r }));
    const { error } = await db().from("activities").insert(chunk);
    if (error) console.error("activity log failed:", error.message);
  }
}

/** Every row of a query, 1000 at a time (PostgREST caps a single response at 1000 rows). */
export async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await page(from, from + 999)) ?? [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
