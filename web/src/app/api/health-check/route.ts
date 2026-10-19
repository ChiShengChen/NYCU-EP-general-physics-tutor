import { NextResponse } from "next/server";
import { runHealthChecks } from "@/lib/health";

export const maxDuration = 15;
export const dynamic = "force-dynamic";

/**
 * GET /api/health-check
 *
 * Lightweight readiness probe for uptime monitors (UptimeRobot /
 * cron-job.org / Vercel Monitoring). Public — no auth — and never leaks
 * more than "this env var is present" booleans. The check logic lives in
 * `lib/health.ts` so the `/health-check` page can call it directly.
 *
 *   - 200 ok / degraded
 *   - 503 down (a CRITICAL dependency failed)
 *
 * No-store because a stale "ok" 60 seconds into an outage is worse than
 * no probe.
 */
export async function GET(): Promise<NextResponse> {
  const payload = await runHealthChecks();
  return NextResponse.json(payload, {
    status: payload.status === "down" ? 503 : 200,
    headers: {
      "Cache-Control": "no-store, must-revalidate",
      "Content-Type": "application/json",
    },
  });
}
