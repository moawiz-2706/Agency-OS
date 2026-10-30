import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./config.js";

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
