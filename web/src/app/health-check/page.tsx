/**
 * Public status page.
 *
 * Renders /api/health-check's JSON in a way a non-engineer can read at
 * a glance: green / yellow / red per check, latencies, last commit SHA,
 * last refreshed timestamp. Auto-refreshes every 30 s so a tab left
 * open during an incident actually updates.
 *
 * No auth so we don't lock ourselves out during an outage, and we
 * never render anything more sensitive than the same boolean checks
 * the API returns.
 */

import { Suspense } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Check {
  ok: boolean;
  critical: boolean;
  status: "ok" | "degraded" | "down";
  latencyMs: number | null;
  detail?: string;
}

interface HealthPayload {
  status: "ok" | "degraded" | "down";
  env: string;
  commit: string | null;
  checkedAt: string;
  checks: Record<string, Check>;
}

const STATUS_TONE: Record<HealthPayload["status"], string> = {
  ok: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-100 border-emerald-300 dark:border-emerald-700",
  degraded: "bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700",
  down: "bg-rose-100 dark:bg-rose-900/40 text-rose-900 dark:text-rose-100 border-rose-300 dark:border-rose-700",
};

const STATUS_LABEL: Record<HealthPayload["status"], string> = {
  ok: "🟢 全部正常",
  degraded: "🟡 部分降級",
  down: "🔴 服務異常",
};

async function fetchHealth(): Promise<HealthPayload | { error: string }> {
  // We can't import the route handler directly without crossing the
  // Server / Edge boundary, so use a relative fetch. cache: "no-store"
  // because rendering a stale status during an outage defeats the page.
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const res = await fetch(`${baseUrl}/api/health-check`, { cache: "no-store" });
    return (await res.json()) as HealthPayload;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function fmtLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function CheckRow({ name, check }: { name: string; check: Check }) {
  const dot =
    check.status === "ok"
      ? "bg-emerald-500"
      : check.status === "degraded"
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 last:border-b-0">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
      <span className="font-mono text-sm text-slate-800 dark:text-slate-100 min-w-[140px]">{name}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {check.critical ? "必要" : "選用"}
      </span>
      <span className="ml-auto text-xs tabular-nums text-slate-600 dark:text-slate-300">
        {fmtLatency(check.latencyMs)}
      </span>
      {check.detail && (
        <span
          className={`text-xs ${check.ok ? "text-slate-500 dark:text-slate-400" : "text-rose-600 dark:text-rose-300"}`}
          title={check.detail}
        >
          {check.detail.length > 60 ? `${check.detail.slice(0, 60)}…` : check.detail}
        </span>
      )}
    </div>
  );
}

async function HealthBody() {
  const payload = await fetchHealth();
  if ("error" in payload) {
    return (
      <div className="rounded-2xl border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/40 px-4 py-6 text-sm text-rose-900 dark:text-rose-100">
        <p className="font-semibold mb-1">🔴 無法取得 health check</p>
        <p className="text-xs">{payload.error}</p>
      </div>
    );
  }

  const tone = STATUS_TONE[payload.status];
  return (
    <>
      <div className={`rounded-2xl border px-5 py-4 ${tone}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-lg font-semibold">{STATUS_LABEL[payload.status]}</span>
          <span className="ml-auto text-xs tabular-nums opacity-70">
            {new Date(payload.checkedAt).toLocaleString("zh-TW")}
          </span>
        </div>
        <div className="text-xs mt-1 opacity-80">
          環境 {payload.env}
          {payload.commit && (
            <>
              {" · "}
              commit <span className="font-mono">{payload.commit.slice(0, 7)}</span>
            </>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
        {Object.entries(payload.checks).map(([name, check]) => (
          <CheckRow key={name} name={name} check={check} />
        ))}
      </div>

      <details className="text-xs text-slate-500 dark:text-slate-400">
        <summary className="cursor-pointer hover:text-slate-700 dark:hover:text-slate-200">
          原始 JSON（給 uptime monitor 用）
        </summary>
        <pre className="mt-2 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto">
{JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </>
  );
}

export default function HealthCheckPage() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">🩺 系統健檢</h1>
          <Link
            href="/"
            className="ml-auto text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            ← 回首頁
          </Link>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          檢測 Supabase 連線、Gemini key、OAuth 設定、Sentry、管理員設定。
          頁面每 30 秒自動重整；可直接給 uptime 監測指向 <span className="font-mono">/api/health-check</span>（critical 失敗回 503）。
        </p>
        <Suspense
          fallback={
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
              檢測中…
            </div>
          }
        >
          <HealthBody />
        </Suspense>
        <meta httpEquiv="refresh" content="30" />
      </div>
    </main>
  );
}
