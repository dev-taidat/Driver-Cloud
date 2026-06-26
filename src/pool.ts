// Chay cac tac vu bat dong bo voi gioi han so luong chay dong thoi.
export async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function loop(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => loop());
  await Promise.all(runners);
  return results;
}

// Thu lai voi exponential backoff khi gap loi tam thoi cua Drive (429/5xx/rot mang).
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 600;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      if (opts.signal?.aborted) throw e;
      const status = Number(e?.code ?? e?.status ?? e?.response?.status);
      const netCode = String(e?.code ?? "");
      const retriable =
        [408, 429, 500, 502, 503, 504].includes(status) ||
        ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EPIPE"].includes(netCode) ||
        /rate.?limit|backenderror|backend error|timeout|socket hang up|network/i.test(String(e?.message || ""));
      if (attempt >= retries || !retriable) throw e;
      const delay = baseMs * 2 ** attempt + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
