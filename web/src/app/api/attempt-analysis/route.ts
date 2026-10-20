import { NextRequest, NextResponse } from "next/server";
import { analyzeAttempt, getCachedAnalysis } from "@/lib/attempt-analysis";
import { checkDailyQuota, quotaExceededResponse } from "@/lib/usage-log";
import { checkIpRateLimit, ipRateLimitedResponse } from "@/lib/rate-limit";
import { resolveStudentId } from "@/lib/resolve-student-id";
import { captureRouteError, initBreadcrumbs } from "@/lib/sentry";

export const maxDuration = 60;

/**
 * GET /api/attempt-analysis?attemptId=123&studentId=xxx
 *   Cached analysis for one attempt, or `{ analysis: null }` when none has
 *   been generated yet (or the cached row is from an older prompt
 *   version). Never calls the LLM — safe to hit on every page view.
 *
 * POST /api/attempt-analysis  { attemptId, studentId?, force? }
 *   Generate (or return cached) analysis. `force: true` regenerates even
 *   when a cached row exists. Goes through the same IP rate-limit + daily
 *   quota gates as every other AI route.
 */
export async function GET(req: NextRequest) {
  const attemptId = parseInt(req.nextUrl.searchParams.get("attemptId") ?? "");
  const { studentId } = await resolveStudentId(req.nextUrl.searchParams.get("studentId"));
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });
  if (!Number.isInteger(attemptId)) return NextResponse.json({ error: "attemptId required" }, { status: 400 });

  const record = await getCachedAnalysis(attemptId, studentId);
  return NextResponse.json({ analysis: record });
}

export async function POST(req: Request) {
  initBreadcrumbs();
  const body = await req.json().catch(() => ({}));
  const attemptId = Number(body?.attemptId);
  const force = body?.force === true;
  const { studentId } = await resolveStudentId(body?.studentId);

  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });
  if (!Number.isInteger(attemptId)) return NextResponse.json({ error: "attemptId required" }, { status: 400 });

  const rate = await checkIpRateLimit(req);
  if (!rate.allowed) {
    const ipResp = ipRateLimitedResponse(rate);
    return NextResponse.json(ipResp.body, { status: ipResp.status });
  }

  const quota = await checkDailyQuota(studentId);
  if (quota.blocked) {
    const r = quotaExceededResponse(quota);
    return NextResponse.json(r.body, { status: r.status });
  }

  try {
    const record = await analyzeAttempt(attemptId, studentId, { force });
    return NextResponse.json({ analysis: record });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      return NextResponse.json({ error: "attempt not found" }, { status: 404 });
    }
    captureRouteError(err, { endpoint: "/api/attempt-analysis", studentId, meta: { attemptId } });
    return NextResponse.json({ error: "analysis failed" }, { status: 500 });
  }
}
