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
