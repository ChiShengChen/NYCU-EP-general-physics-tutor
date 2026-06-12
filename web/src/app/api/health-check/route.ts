import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 15;
export const dynamic = "force-dynamic";

/**
 * GET /api/health-check
 *
 * Lightweight readiness probe. Pings every external dependency the app
 * relies on and reports per-check status + latency. Public — no auth,
 * so uptime monitors (UptimeRobot / cron-job.org / Vercel Monitoring)
 * can hit it without juggling credentials. Doesn't leak anything more
 * sensitive than "this env var is present" booleans.
 *
 * Status semantics:
 *   - 200 ok        all checks passed
 *   - 200 degraded  at least one OPTIONAL dependency failed
 *                   (Sentry DSN missing, Brave search down, etc.)
 *   - 503 down      at least one CRITICAL dependency failed
 *                   (Supabase unreachable, Gemini key missing)
 *
 * Return body is the same shape regardless of status so the /health-check
 * page renders consistently. Cache headers force no-store because a stale
 * "ok" 60 seconds after an outage starts is worse than no probe.
 */

interface CheckResult {
  ok: boolean;
  critical: boolean;
  status: "ok" | "degraded" | "down";
  latencyMs: number | null;
  detail?: string;
}

async function check(
  name: string,
  critical: boolean,
  fn: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<[string, CheckResult]> {
  const t0 = Date.now();
  try {
    const { ok, detail } = await fn();
    const latencyMs = Date.now() - t0;
    return [
      name,
      {
        ok,
        critical,
        status: ok ? "ok" : critical ? "down" : "degraded",
        latencyMs,
        detail,
      },
    ];
  } catch (err) {
    return [
      name,
      {
        ok: false,
        critical,
        status: critical ? "down" : "degraded",
        latencyMs: Date.now() - t0,
        detail: err instanceof Error ? err.message : String(err),
      },
    ];
  }
}

export async function GET(): Promise<NextResponse> {
  const checks: Array<Promise<[string, CheckResult]>> = [
    // Supabase: a trivial SELECT against student_profiles. If it returns
    // a row count or error we know the connection + RLS service-role
    // path are up. Critical: nothing works without the DB.
    check("supabase", true, async () => {
      const supabase = createServiceClient();
      const { error } = await supabase
        .from("student_profiles")
        .select("id", { count: "exact", head: true })
        .limit(1);
      if (error) return { ok: false, detail: error.message };
      return { ok: true };
    }),

    // Gemini: we don't burn a real call here — just verify the key is
    // configured. Catching an outage in the live API would require an
    // actual call, and the daily quota guard already surfaces those.
    check("gemini-config", true, async () => {
      const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
      if (!key) return { ok: false, detail: "GOOGLE_GENERATIVE_AI_API_KEY missing" };
      return { ok: true, detail: `key length ${key.length}` };
    }),

    // OAuth: verify the Supabase URL + anon key are configured, since
    // Google / GitHub login flow goes through Supabase Auth.
    check("auth-config", true, async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
      if (!url || !anon || !service) {
        return { ok: false, detail: "supabase env missing" };
      }
      return { ok: true };
    }),

    // Sentry: optional. "degraded" if unset because the app still works
    // — we just lose error reporting.
    check("sentry", false, async () => {
      if (!process.env.SENTRY_DSN) return { ok: false, detail: "DSN unset" };
      return { ok: true };
    }),

    // Admin gate: degraded if no admin email configured (panel is
    // unreachable but normal student paths work).
    check("admin", false, async () => {
      const raw = process.env.ADMIN_EMAILS ?? "";
      const count = raw.split(",").map((s) => s.trim()).filter(Boolean).length;
      if (count === 0) return { ok: false, detail: "ADMIN_EMAILS empty" };
      return { ok: true, detail: `${count} admin(s)` };
    }),
  ];

  const results = Object.fromEntries(await Promise.all(checks));

  const anyCriticalDown = Object.values(results).some(
    (r) => r.critical && !r.ok,
  );
  const anyOptionalDegraded = Object.values(results).some(
    (r) => !r.critical && !r.ok,
  );
  const overall: "ok" | "degraded" | "down" = anyCriticalDown
    ? "down"
    : anyOptionalDegraded
      ? "degraded"
      : "ok";

  return NextResponse.json(
    {
      status: overall,
      env: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      checkedAt: new Date().toISOString(),
      checks: results,
    },
    {
      status: overall === "down" ? 503 : 200,
      headers: {
        "Cache-Control": "no-store, must-revalidate",
        "Content-Type": "application/json",
      },
    },
  );
}
