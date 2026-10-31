#!/usr/bin/env node
// Audit lead websites in bulk, 6 at a time, with the same rules as the MCP tool
// (robots.txt, public addresses only, 10 s timeout, 1.5 MB cap, DNS retries).
// No Claude involved.
//
// Usage: pnpm audit-leads [--limit N] [--retry-failed] [--concurrency N]
import "../env.js";
import { auditBatch, failureReason, type AuditOutcome } from "@agencyos/core";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = args[i];
  return a.includes("=") ? a.split("=")[1] : args[i + 1];
};
if (flag("help")) {
  console.log("Usage: pnpm audit-leads [--limit N] [--retry-failed] [--concurrency N]");
  process.exit(0);
}
const limit = value("limit") ? Number(value("limit")) : undefined;
const concurrency = Math.min(12, Math.max(1, Number(value("concurrency") ?? 6)));
const retryFailed = flag("retry-failed");
if (limit !== undefined && !(limit > 0)) {
  console.error("--limit must be a positive number");
  process.exit(1);
}

const started = Date.now();
const width = (n: number) => String(n).length;

const run = await auditBatch({
  limit, retry_failed: retryFailed, concurrency,
  onStart: (total) => {
    if (!total) {
      console.log(retryFailed
        ? "No failed audits to retry."
        : "No unaudited leads with a website. Use --retry-failed to re-check leads whose last audit failed.");
    } else {
      console.log(`Auditing ${total} ${retryFailed ? "previously failed " : ""}site(s), ${concurrency} at a time…\n`);
    }
  },
  onResult: (r: AuditOutcome, done, total) => {
    const pos = `[${String(done).padStart(width(total))}/${total}]`;
    const tier = r.prev_tier && r.prev_tier !== r.tier ? `${r.prev_tier} → ${r.tier}` : r.tier;
    const detail = r.ok ? `score ${r.score} (${tier})` : `failed: ${failureReason(r.error ?? "")}`;
    console.log(`${pos} ${r.ok ? "ok  " : "FAIL"} ${r.name.slice(0, 48).padEnd(48)} ${detail}`);
  },
});

if (!run.total) process.exit(0);

const ok = run.results.filter((r) => r.ok);
const failed = run.results.filter((r) => !r.ok);
const reasons = failed.reduce<Record<string, number>>((m, r) => {
  const k = failureReason(r.error ?? "");
  m[k] = (m[k] ?? 0) + 1;
  return m;
}, {});
const tiers = ok.reduce<Record<string, number>>((m, r) => ((m[r.tier] = (m[r.tier] ?? 0) + 1), m), {});
const moved = ok.filter((r) => r.prev_tier && r.prev_tier !== r.tier).length;
const secs = Math.round((Date.now() - started) / 1000);

console.log(`
Done in ${Math.floor(secs / 60)}m ${secs % 60}s
  checked:   ${run.results.length} of ${run.total}
  ok:        ${ok.length}  (high ${tiers.high ?? 0}, medium ${tiers.medium ?? 0}, low ${tiers.low ?? 0}; ${moved} changed tier)
  failed:    ${failed.length}${failed.length ? `  (${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}`);

if (run.stopped_offline) {
  console.log(`\nStopped: this PC went offline. The ${run.total - run.results.length} unchecked lead(s) were not marked; run the same command again when you're back online.`);
  process.exit(2);
}
if (run.error) {
  console.error(`\nStopped on an error: ${run.error}`);
  process.exit(1);
}
if (failed.length) console.log(`\nRe-check the failures later with: pnpm audit-leads --retry-failed`);
