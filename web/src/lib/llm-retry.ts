/**
 * Retry a Promise-returning function once on transient errors.
 *
 * Gemini (and Vercel's edge network in front of it) occasionally throws
 * rate-limit / 503 / fetch-failed errors that resolve on a quick retry.
 * Before this wrapper those bubbled straight to the client as "失敗，請稍後
 * 再試". One retry with a short backoff catches most of them.
 *
 * Usage:
 *   const { object } = await withLLMRetry(() => generateObject({...}));
 *
 * Non-transient errors (schema validation, prompt rejection) skip the
 * retry — there's nothing temporary about a malformed prompt, so retrying
 * just wastes time + tokens.
 */
export async function withLLMRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; label?: string } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 1;
  const label = opts.label ?? "llm";

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number; statusCode?: number })?.status
        ?? (err as { statusCode?: number })?.statusCode;
      const isTransient =
        status === 429 || status === 500 || status === 502 || status === 503 || status === 504
        || /rate.?limit|quota|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|overloaded/i.test(msg);

      if (!isTransient || attempt === maxRetries) {
        console.error(`[${label}] failed (attempt ${attempt + 1}/${maxRetries + 1}):`, msg);
        throw err;
      }
      const backoffMs = 500 * (attempt + 1);
      console.warn(`[${label}] transient error, retrying in ${backoffMs}ms:`, msg);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}
