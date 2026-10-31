import { test } from "node:test";
import assert from "node:assert/strict";
import { runPool } from "../src/pool.js";
import { failureReason } from "../src/audit.js";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("never runs more than the limit at once, and keeps results in order", async () => {
  let running = 0, peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const { results, completed, error } = await runPool(items, 6, async (n) => {
    running++; peak = Math.max(peak, running);
    await tick(5 + (n % 3) * 3);
    running--;
    return n * 2;
  });
  assert.equal(peak, 6);
  assert.equal(completed, 20);
  assert.equal(error, undefined);
  assert.deepEqual(results, items.map((n) => n * 2));
});

test("after an error nothing new starts; finished work is kept", async () => {
  const started: number[] = [];
  const { results, error } = await runPool(Array.from({ length: 30 }, (_, i) => i), 3, async (n) => {
    started.push(n);
    await tick(5);
    if (n === 4) throw new Error("offline");
    return n;
  });
  assert.equal((error as Error).message, "offline");
  assert.ok(started.length < 10, `stopped early (started ${started.length})`);
  assert.equal(results[0], 0);
  assert.equal(results[4], undefined);
});

test("handles an empty list", async () => {
  assert.deepEqual(await runPool([], 6, async () => 1), { results: [], completed: 0 });
});

test("audit failures group into readable reasons", () => {
  assert.equal(failureReason("getaddrinfo ENOTFOUND acme.example"), "domain not found");
  assert.equal(failureReason("HTTP 503"), "HTTP 5xx");
  assert.equal(failureReason("The operation was aborted due to timeout"), "timed out");
  assert.equal(failureReason("robots.txt disallows crawling"), "blocked by robots.txt");
});
