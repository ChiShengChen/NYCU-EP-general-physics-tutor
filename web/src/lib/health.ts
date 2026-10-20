import { createServiceClient } from "@/lib/supabase/server";
import { getIpRateLimitBackend, pingIpRateLimitStore } from "@/lib/rate-limit";

/**
 * Health probe logic shared by `/api/health-check` (JSON for uptime
 * monitors) and the `/health-check` status page.
 *
 * It used to live inside the route handler and the page fetched it over
 * HTTP via `VERCEL_URL`. On Vercel that URL is the per-deployment host,
 * which sits behind Deployment Protection and answers with an SSO HTML
 * page — so the public status page rendered 「無法取得 health check」
 * even though the API was fine. Calling the checks directly removes the
 * HTTP hop (and the env-var dependency) entirely.
 *
 * Status semantics:
 *   - ok        all checks passed
 *   - degraded  at least one OPTIONAL dependency failed (Sentry, admin)
 *   - down      at least one CRITICAL dependency failed (Supabase, Gemini key)
 */

export interface HealthCheck {
  ok: boolean;
  critical: boolean;
  status: "ok" | "degraded" | "down";
  latencyMs: number | null;
  detail?: string;
}

export interface HealthPayload {
  status: "ok" | "degraded" | "down";
  env: string;
  commit: string | null;
  checkedAt: string;
  checks: Record<string, HealthCheck>;
}

async function check(
  name: string,
  critical: boolean,
  fn: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<[string, HealthCheck]> {
  const t0 = Date.now();
  try {
    const { ok, detail } = await fn();
    return [name, { ok, critical, status: ok ? "ok" : critical ? "down" : "degraded", latencyMs: Date.now() - t0, detail }];
  } catch (err) {
    return [name, {
      ok: false,
      critical,
      status: critical ? "down" : "degraded",
      latencyMs: Date.now() - t0,
      detail: err instanceof Error ? err.message : String(err),
    }];
  }
}

export async function runHealthChecks(): Promise<HealthPayload> {
  const checks: Array<Promise<[string, HealthCheck]>> = [
    // Supabase: a trivial SELECT against student_profiles. If it returns
    // a row count or error we know the connection + service-role path
    // are up. Critical: nothing works without the DB.
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
    // configured. The daily quota guard already surfaces live-API outages.
    check("gemini-config", true, async () => {
      const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
      if (!key) return { ok: false, detail: "GOOGLE_GENERATIVE_AI_API_KEY missing" };
      return { ok: true, detail: `key length ${key.length}` };
    }),

    // OAuth: Supabase URL + keys, since Google / GitHub login goes
    // through Supabase Auth.
    check("auth-config", true, async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
      if (!url || !anon || !service) return { ok: false, detail: "supabase env missing" };
      return { ok: true };
    }),

    // Sentry: optional — the app works without it, we just lose reporting.
    check("sentry", false, async () => {
      if (!process.env.SENTRY_DSN) return { ok: false, detail: "DSN unset" };
      return { ok: true };
    }),

    // Admin gate: degraded if no admin email configured.
    check("admin", false, async () => {
      const raw = process.env.ADMIN_EMAILS ?? "";
      const count = raw.split(",").map((s) => s.trim()).filter(Boolean).length;
      if (count === 0) return { ok: false, detail: "ADMIN_EMAILS empty" };
      return { ok: true, detail: `${count} admin(s)` };
    }),

    // IP rate-limit store: reports which backend this instance picked.
    // With Upstash configured we do a real PING so `latencyMs` is the
    // Redis round-trip. Optional — the limiter fails open when Redis is
    // unreachable, so a failure here degrades the burst guard, nothing
    // else. In-memory is always "ok" but worth seeing on the status page
    // since it means the cap is per-instance only.
    check("rate-limit-store", false, async () => {
      const backend = getIpRateLimitBackend();
      if (backend === "in-memory") return { ok: true, detail: "in-memory (per-instance)" };
      await pingIpRateLimitStore();
      return { ok: true, detail: "upstash PONG" };
    }),
  ];

  const results = Object.fromEntries(await Promise.all(checks));
  const anyCriticalDown = Object.values(results).some((r) => r.critical && !r.ok);
  const anyOptionalDegraded = Object.values(results).some((r) => !r.critical && !r.ok);
  const status: HealthPayload["status"] = anyCriticalDown ? "down" : anyOptionalDegraded ? "degraded" : "ok";

  return {
    status,
    env: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    checkedAt: new Date().toISOString(),
    checks: results,
  };
}
