"use client";

import { useEffect, useState } from "react";

type UsageSummary = {
  studentId: string;
  periodStart: string;
  totals: {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  endpoints: {
    endpoint: string;
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  }[];
  daily: { date: string; tokens: number; costUsd: number }[];
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}

/** Tiny SVG sparkline. Renders an area-filled polyline with circle markers
 *  at each daily bucket. All days display even when the value is 0 so the
 *  spacing stays uniform across the 7-day window. */
function Sparkline({ data }: { data: { date: string; tokens: number }[] }) {
  const W = 140;
  const H = 36;
  const PAD_X = 4;
  const PAD_Y = 4;
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.tokens));
  const stepX = data.length > 1 ? (W - PAD_X * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = PAD_X + i * stepX;
    const y = H - PAD_Y - (d.tokens / max) * (H - PAD_Y * 2);
    return { x, y, d };
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${H - PAD_Y} L${points[0].x.toFixed(1)},${H - PAD_Y} Z`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-indigo-500 dark:text-indigo-400">
      <path d={areaPath} fill="currentColor" opacity={0.15} />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.5} fill="currentColor">
          <title>{`${p.d.date}: ${p.d.tokens.toLocaleString()} tokens`}</title>
        </circle>
      ))}
    </svg>
  );
}

const ENDPOINT_LABELS: Record<string, string> = {
  "/api/chat": "自由問答",
  "/api/quiz": "自動測驗",
  "/api/exam": "模擬考",
  "/api/hint": "提示",
  "/api/preview": "章節預習",
  "/api/study-plan": "學習計畫",
  "/api/regen-question": "重新出題",
  "/api/concept-compare": "概念比較",
};

export function UsageWidget({ studentId }: { studentId: string | null }) {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!studentId) return;
    fetch(`/api/usage/me?studentId=${studentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setData(d); })
      .catch(() => {});
  }, [studentId]);

  if (!data || data.totals.calls === 0) return null;

  return (
    <div className="w-full max-w-5xl mb-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl">📊</span>
          <div className="min-w-0">
            <div className="text-xs text-slate-500 dark:text-slate-400">本月 AI 使用量</div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {fmtTokens(data.totals.totalTokens)} tokens · {fmtCost(data.totals.costUsd)} ·{" "}
              {data.totals.calls} 次呼叫
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end">
            <Sparkline data={data.daily} />
            <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">近 7 日</span>
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {expanded ? "收合 ▴" : "明細 ▾"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="text-left font-normal pb-2">功能</th>
                <th className="text-right font-normal pb-2">呼叫</th>
                <th className="text-right font-normal pb-2">Tokens</th>
                <th className="text-right font-normal pb-2">估算成本</th>
              </tr>
            </thead>
            <tbody className="text-slate-700 dark:text-slate-200">
              {data.endpoints.map((e) => (
                <tr key={e.endpoint} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5">{ENDPOINT_LABELS[e.endpoint] ?? e.endpoint}</td>
                  <td className="text-right py-1.5 tabular-nums">{e.calls}</td>
                  <td className="text-right py-1.5 tabular-nums">{fmtTokens(e.totalTokens)}</td>
                  <td className="text-right py-1.5 tabular-nums">{fmtCost(e.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
            成本依 Gemini 公開定價估算，僅供參考。期間為本月 1 號 00:00 UTC 至今。
          </p>
        </div>
      )}
    </div>
  );
}
