import { logUsage, type UsageNumbers } from "@/lib/usage-log";

/**
 * Retry a Promise-returning function once on transient errors, and
 * fire-and-forget log token usage on success.
 *
 * Gemini (and Vercel's edge network in front of it) occasionally throws
 * rate-limit / 503 / fetch-failed errors that resolve on a quick retry.
 * Before this wrapper those bubbled straight to the client as "失敗，請稍後
 * 再試". One retry with a short backoff catches most of them.
 *
 * If `studentId` and `endpoint` are passed, the result's `.usage` field
 * (present on generateObject/generateText results) is logged to the
 * token_usage table for cost tracking.
 *
 * Usage:
 *   const { object } = await withLLMRetry(
 *     () => generateObject({ model, schema, prompt }),
 *     { label: "quiz/grade", studentId, endpoint: "/api/quiz",
 *       model: "gemini-2.5-flash" },
 *   );
 *
 * Non-transient errors (schema validation, prompt rejection) skip the
 * retry — there's nothing temporary about a malformed prompt, so retrying
 * just wastes time + tokens.
 */
export async function withLLMRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxRetries?: number;
    label?: string;
    studentId?: string | null;
    endpoint?: string;
    model?: string;
  } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 1;
  const label = opts.label ?? "llm";

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (opts.endpoint && opts.model) {
        const usage = (result as { usage?: UsageNumbers } | null)?.usage;
        if (usage) {
          logUsage(
            { studentId: opts.studentId, endpoint: opts.endpoint, label, model: opts.model },
            usage,
          );
        }
      }
      return result;
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
