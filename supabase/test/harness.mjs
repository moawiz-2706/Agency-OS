// Real Postgres (PGlite) with stand-ins for Supabase's auth schema and roles,
// and every migration applied in order. Shared by the database tests.
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = new URL("../migrations/", import.meta.url);

export const migrationFiles = () => readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
export const migrationSql = (f) => readFileSync(new URL(f, dir), "utf8");

export async function createDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on all functions in schema auth to anon, authenticated;
  `);
  for (const f of migrationFiles()) await db.exec(migrationSql(f));

  /** Run queries as a logged-in Supabase user (role authenticated + JWT claims), then switch back. */
  async function as(user, fn) {
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: user.sub, email: user.email, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { return await fn(); } finally {
      await db.exec("reset role");
      await db.query(`select set_config('request.jwt.claims', '', false)`);
    }
  }
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  return { db, as, rows };
}

export const USERS = {
  OWNER: { sub: "00000000-0000-0000-0000-00000000000a", email: "owner@agency.test" },
  PARTNER: { sub: "00000000-0000-0000-0000-00000000000b", email: "partner@agency.test" },
  UNLINKED: { sub: "00000000-0000-0000-0000-00000000000c", email: "New.Partner@agency.test" },
  OUTSIDER: { sub: "00000000-0000-0000-0000-0000000000ff", email: "someone@else.test" },
};
