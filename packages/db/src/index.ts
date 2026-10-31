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

export async function logActivity(companyId: string | null, type: string, payload: object = {}) {
  const { error } = await db().from("activities").insert({ company_id: companyId, type, payload });
  if (error) console.error("activity log failed:", error.message);
}

export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
