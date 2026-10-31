/**
 * Run `fn` over `items` with at most `limit` in flight, keeping results in input order.
 * If a call throws, nothing new starts; calls already running finish, and the first
 * error is returned with whatever completed, so the caller can report partial progress.
 */
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<{ results: (R | undefined)[]; completed: number; error?: unknown }> {
  const results: (R | undefined)[] = new Array(items.length);
  let next = 0;
  let completed = 0;
  let error: unknown;

  async function worker() {
    while (error === undefined && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
        completed++;
      } catch (e) {
        if (error === undefined) error = e;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return { results, completed, ...(error !== undefined && { error }) };
}
