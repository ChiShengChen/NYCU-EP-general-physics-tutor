import { createServiceClient } from "@/lib/supabase/server";

/** Gemini 2.5 Flash pricing per 1M tokens (USD). Used at query time to
 *  estimate cost from stored prompt/completion token counts. Keep this
 *  in sync with https://ai.google.dev/pricing — update when rates change. */
export const MODEL_RATES: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash": { input: 0.075, output: 0.30 },
  "gemini-2.5-flash-lite": { input: 0.0375, output: 0.15 },
  "gemini-2.5-pro": { input: 1.25, output: 5.0 },
};

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const rate = MODEL_RATES[model] ?? MODEL_RATES["gemini-2.5-flash"];
  return (promptTokens / 1_000_000) * rate.input + (completionTokens / 1_000_000) * rate.output;
}

export type UsageContext = {
  studentId?: string | null;
  endpoint: string;
  label?: string;
  model: string;
};

export type UsageNumbers = {
  promptTokens?: number;
  inputTokens?: number;
  completionTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

/** Fire-and-forget insert into token_usage. Never throws — failure to log
 *  must not break the user-facing response. */
export function logUsage(ctx: UsageContext, usage: UsageNumbers | undefined | null): void {
  if (!usage) return;
  // The AI SDK uses promptTokens/completionTokens in some versions and
  // inputTokens/outputTokens in others — accept both.
  const prompt = usage.promptTokens ?? usage.inputTokens ?? 0;
  const completion = usage.completionTokens ?? usage.outputTokens ?? 0;
  const total = usage.totalTokens ?? prompt + completion;
  if (!prompt && !completion && !total) return;

  void (async () => {
    try {
      const supabase = createServiceClient();
      const { error } = await supabase.from("token_usage").insert({
        student_id: ctx.studentId ?? null,
        endpoint: ctx.endpoint,
        label: ctx.label ?? null,
        model: ctx.model,
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
      });
      if (error) console.error("[usage-log] insert failed:", error);
    } catch (err) {
      console.error("[usage-log] unexpected:", err);
    }
  })();
}

/* ─── Daily quota ──────────────────────────────────────────────────────
 *
 * Per-student daily token budget, enforced at the entry of every route
 * that calls Gemini. Two tiers:
 *
 *   - Authenticated (student_profiles.auth_user_id IS NOT NULL): 2M/day
 *   - Anonymous (no auth_user_id, or unknown studentId):           5k/day
 *
 * 2M / day on Flash works out to roughly NT$7–12 per student per day if
 * they actually hit the cap — generous enough that even a heavy
 * study-session day (1–2 hours of nonstop Q&A + a couple of exam runs)
 * stays comfortably under. The anonymous quota stays tight: enough to
 * try one or two features and decide to sign in, not enough to be worth
 * scraping with throwaway browsers.
 *
 * Day boundary is midnight in Asia/Taipei — the course is taught in
 * Taiwan, so resetting at 00:00 UTC (8am Taipei) would surprise students
 * mid-study session. Computed by shifting clock forward 8h, snapping to
 * UTC midnight, then shifting back.
 */

export const DAILY_LIMIT_AUTH = 2_000_000;
export const DAILY_LIMIT_ANON = 5_000;

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** ISO timestamp of the most recent 00:00 Asia/Taipei boundary. */
function startOfDayTaipei(): string {
  const now = Date.now();
  const taipei = new Date(now + TAIPEI_OFFSET_MS);
  taipei.setUTCHours(0, 0, 0, 0);
  return new Date(taipei.getTime() - TAIPEI_OFFSET_MS).toISOString();
}

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  blocked: boolean;
  isAuthenticated: boolean;
  resetAt: string;   // ISO of the next 00:00 Taipei boundary
}

/** Look up today's token usage for a student and compare to their daily
 *  limit. Treats missing studentId or DB lookup failures as anonymous so
 *  a half-broken auth path can't accidentally hand out the bigger quota.
 *  Does NOT throw — callers should branch on `.blocked`. */
export async function checkDailyQuota(studentId: string | null | undefined): Promise<QuotaStatus> {
  const startISO = startOfDayTaipei();
  const resetAt = new Date(new Date(startISO).getTime() + 24 * 60 * 60 * 1000).toISOString();

  // Anonymous tier wins when no student id is available at all.
  if (!studentId) {
    return {
      used: 0,
      limit: DAILY_LIMIT_ANON,
      remaining: DAILY_LIMIT_ANON,
      blocked: false,
      isAuthenticated: false,
      resetAt,
    };
  }

  const supabase = createServiceClient();

  // One round-trip each to determine the tier and to sum today's usage.
  // Both are short queries; we don't bother caching since /api/chat is
  // streaming-bound and a single sub-50ms DB read is negligible next to
  // the model latency it gates.
  const [{ data: profile }, { data: rows }] = await Promise.all([
    supabase.from("student_profiles").select("auth_user_id").eq("id", studentId).maybeSingle(),
    supabase
      .from("token_usage")
      .select("total_tokens")
      .eq("student_id", studentId)
      .gte("created_at", startISO),
  ]);

  const isAuthenticated = !!profile?.auth_user_id;
  const limit = isAuthenticated ? DAILY_LIMIT_AUTH : DAILY_LIMIT_ANON;
  const used = (rows ?? []).reduce((acc, r) => acc + (r.total_tokens ?? 0), 0);
  const remaining = Math.max(0, limit - used);

  return {
    used,
    limit,
    remaining,
    blocked: used >= limit,
    isAuthenticated,
    resetAt,
  };
}

/** Convenience: standardised 429 payload so all routes return the same
 *  shape, which the client can recognise and surface as a banner. */
export function quotaExceededResponse(q: QuotaStatus): {
  status: 429;
  body: {
    error: "quota_exceeded";
    message: string;
    used: number;
    limit: number;
    remaining: number;
    isAuthenticated: boolean;
    resetAt: string;
  };
} {
  const msg = q.isAuthenticated
    ? `今日 token 額度已用完（${q.limit.toLocaleString()} tokens），明天 00:00 重置再回來。`
    : `匿名額度已用完（${q.limit.toLocaleString()} tokens / day）。登入 Google / GitHub 帳號可拿到 ${DAILY_LIMIT_AUTH.toLocaleString()} / day。`;
  return {
    status: 429,
    body: {
      error: "quota_exceeded",
      message: msg,
      used: q.used,
      limit: q.limit,
      remaining: q.remaining,
      isAuthenticated: q.isAuthenticated,
      resetAt: q.resetAt,
    },
  };
}
