# M1 plan — restructure into a pnpm monorepo

Goal (SPEC, Build milestones → M1): move v0.1 into the layout from SPEC "Extension design" with no
change in tool behaviour, and keep every test green.

## Layout

| Package | Takes from v0.1 | Depends on |
|---|---|---|
| `packages/db` (`@agencyos/db`) | `db.ts` (client, `must`, `logActivity`) + `env()` | supabase-js |
| `packages/adapters` (`@agencyos/adapters`) | `places.ts` → `GooglePlacesSource` behind `LeadSource`; SSRF-safe fetch + robots.txt from `audit.ts` | nothing internal |
| `packages/core` (`@agencyos/core`) | `config.ts` presets, `scoring.ts`, signal detection from `audit.ts`, and every tool body from `index.ts` | db, adapters |
| `apps/mcp` (`@agencyos/mcp`) | `index.ts`: tool registration + Zod input schemas only | core |

`apps/web` and `apps/worker` arrive in M6 and Phase 2. Migrations stay in `supabase/migrations`
(where the Supabase CLI and the README expect them).

## Rules applied

- Adapters decide nothing and read no env: config (API key, user agent) is passed in by core.
- Only `apps/mcp` loads `.env` (from the repo root), so the Claude Desktop setup stays one file.
- Each package exports `src` under a `source` condition (tests and `dev` run from TypeScript) and
  `dist` otherwise (what Claude Desktop runs).
- Tests move next to the code they cover: scoring and signals → core; places mapping and the SSRF
  guard → adapters.

## Done when

- `pnpm build` and `pnpm test` pass.
- The MCP server lists the same 9 tools with the same input schemas as v0.1.
- 100+ real leads saved and scored (needs your Supabase project and Google key — README steps 1–2).
