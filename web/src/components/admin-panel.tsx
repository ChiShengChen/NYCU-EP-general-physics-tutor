"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiKey } from "@/lib/api";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThemeToggle } from "./theme-provider";

/**
 * 「管理員後台」 — two-tab triage panel for the people whose emails are
 * in ADMIN_EMAILS. Tab 1 (Usage) surfaces the 30-day token spend so we
 * can spot runaway costs and which endpoints / students drove them.
 * Tab 2 (Reports) is the moderation queue for question_reports: list
 * open reports, see the offending question + the student's stated
 * reason, mark as resolved with an optional note. Everything is read-
 * mostly; the only write is the resolve / reopen toggle.
 *
 * Server-side gating lives in /api/admin/check + getAdminContext, so
 * even if a non-admin somehow navigates to this mode, the API calls
 * return 403 and we render the "forbidden" empty state.
 */

const REASON_LABELS: Record<string, string> = {
  unclear: "題意不清",
  wrong_answer: "答案有誤",
  bad_explanation: "解釋不好",
  too_easy: "太簡單",
  too_hard: "太難",
  off_topic: "超綱",
  other: "其他",
};

const REASON_TONES: Record<string, string> = {
  unclear: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  wrong_answer: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",
  bad_explanation: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300",
  too_easy: "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300",
  too_hard: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300",
  off_topic: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
  other: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
};

interface UsageData {
  windowDays: number;
  totals: { calls: number; totalTokens: number; costUsd: number; distinctStudents: number };
  topStudents: { label: string; isAuthenticated: boolean; calls: number; totalTokens: number; costUsd: number }[];
  endpoints: { endpoint: string; calls: number; totalTokens: number; costUsd: number }[];
  daily: { date: string; tokens: number; costUsd: number }[];
}

interface Report {
  id: number;
  student_id: string | null;
  source_chapter: number | null;
  question_text: string | null;
  correct_answer: string | null;
  reason: string;
  detail: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by_email: string | null;
  resolution_note: string | null;
}
interface ReportsData { reports: Report[] }

type Tab = "usage" | "reports";

export function AdminPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("usage");
  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">🛡️</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">管理員後台</h1>
        <div className="ml-auto flex items-center gap-1 text-xs">
          <button
            onClick={() => setTab("usage")}
            className={`px-3 py-1.5 rounded-lg ${tab === "usage" ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
          >
            📊 Token 使用
          </button>
          <button
            onClick={() => setTab("reports")}
            className={`px-3 py-1.5 rounded-lg ${tab === "reports" ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
          >
            🚩 問題回報
          </button>
        </div>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {tab === "usage" ? <UsageView /> : <ReportsView />}
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/* ─── Usage tab ─── */

function UsageView() {
  const { data, error, isLoading } = useSWR<UsageData>("/api/admin/usage");

  if (isLoading) return <Centered>載入中...</Centered>;
  if (error) {
    const status = (error as { status?: number })?.status;
    if (status === 403) return <Forbidden />;
    return <Centered>讀取失敗：{String(error)}</Centered>;
  }
  if (!data) return null;

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.tokens));

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="呼叫總數" value={String(data.totals.calls)} />
        <Stat label="Tokens (30 天)" value={fmtTokens(data.totals.totalTokens)} />
        <Stat label="估算成本" value={fmtCost(data.totals.costUsd)} emphasis />
        <Stat label="活躍學生" value={String(data.totals.distinctStudents)} />
      </div>

      <Section title={`📈 每日 Tokens（最近 ${data.windowDays} 天）`}>
        <div className="flex items-end gap-1 h-32">
          {data.daily.map((d) => {
            const h = Math.max(2, (d.tokens / maxDaily) * 120);
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className="w-full bg-indigo-500 dark:bg-indigo-400 rounded-t"
                  style={{ height: `${h}px` }}
                  title={`${d.date}: ${d.tokens.toLocaleString()} tokens · ${fmtCost(d.costUsd)}`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-1">
          <span>{data.daily[0]?.date}</span>
          <span>{data.daily[data.daily.length - 1]?.date}</span>
        </div>
      </Section>

      <Section title="🔝 用量前 25 名學生">
        <Table
          headers={["學生", "次數", "Tokens", "估算成本"]}
          rows={data.topStudents.map((s) => [
            <span key="0" className="truncate inline-block max-w-[260px] align-middle">
              {s.label}{" "}
              {!s.isAuthenticated && <span className="text-[10px] text-slate-400">匿名</span>}
            </span>,
            String(s.calls),
            fmtTokens(s.totalTokens),
            fmtCost(s.costUsd),
          ])}
        />
      </Section>

      <Section title="🔀 各 API 端點用量">
        <Table
          headers={["端點", "次數", "Tokens", "估算成本"]}
          rows={data.endpoints.map((e) => [
            <span key="0" className="font-mono text-[11px]">{e.endpoint}</span>,
            String(e.calls),
            fmtTokens(e.totalTokens),
            fmtCost(e.costUsd),
          ])}
        />
      </Section>
    </div>
  );
}

/* ─── Reports tab ─── */

function ReportsView() {
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const { data, error, isLoading, mutate } = useSWR<ReportsData>(apiKey("/api/admin/reports", { status }));

  if (isLoading) return <Centered>載入中...</Centered>;
  if (error) {
    const code = (error as { status?: number })?.status;
    if (code === 403) return <Forbidden />;
    return <Centered>讀取失敗：{String(error)}</Centered>;
  }
  if (!data) return null;

  const resolve = async (id: number, action: "resolve" | "reopen") => {
    const note = action === "resolve" ? window.prompt("處理備註（可空白）：") ?? "" : "";
    const res = await fetch("/api/admin/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, note }),
    });
    if (res.ok) await mutate();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2 text-xs">
        {(["open", "resolved", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg border ${
              status === s
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
          >
            {s === "open" ? "未處理" : s === "resolved" ? "已處理" : "全部"}
          </button>
        ))}
        <span className="ml-auto text-slate-400 dark:text-slate-500">共 {data.reports.length} 筆</span>
      </div>

      {data.reports.length === 0 ? (
        <Centered>沒有資料</Centered>
      ) : (
        <div className="space-y-3">
          {data.reports.map((r) => (
            <div key={r.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs mb-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full font-medium ${REASON_TONES[r.reason] ?? REASON_TONES.other}`}>
                  {REASON_LABELS[r.reason] ?? r.reason}
                </span>
                {r.source_chapter && (
                  <span className="font-mono text-slate-500 dark:text-slate-400">Ch{String(r.source_chapter).padStart(2, "0")}</span>
                )}
                <span className="text-slate-400 dark:text-slate-500">
                  {new Date(r.created_at).toLocaleString("zh-TW")}
                </span>
                {r.resolved_at && (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-300">
                    ✓ {r.resolved_by_email} · {new Date(r.resolved_at).toLocaleDateString("zh-TW")}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-slate-400">
                  {r.student_id ? `學生 ${r.student_id.slice(0, 8)}` : "匿名"}
                </span>
              </div>

              {r.question_text && (
                <div className="text-sm text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2 mb-2">
                  <MarkdownRenderer content={r.question_text.slice(0, 600)} />
                </div>
              )}
              {r.correct_answer && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  <span className="font-medium">標記正解：</span> {r.correct_answer.slice(0, 200)}
                </p>
              )}
              {r.detail && (
                <p className="text-xs text-slate-700 dark:text-slate-200 italic mb-2">
                  「{r.detail}」
                </p>
              )}
              {r.resolution_note && (
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                  <span className="font-medium">處理備註：</span> {r.resolution_note}
                </p>
              )}

              <div className="flex justify-end gap-2 mt-2">
                {r.resolved_at ? (
                  <button
                    onClick={() => resolve(r.id, "reopen")}
                    className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    重新開啟
                  </button>
                ) : (
                  <button
                    onClick={() => resolve(r.id, "resolve")}
                    className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-700"
                  >
                    標記已處理
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Small primitives ─── */

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${emphasis ? "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"}`}>
      <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${emphasis ? "text-indigo-700 dark:text-indigo-300" : "text-slate-800 dark:text-slate-100"}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[420px]">
        <thead>
          <tr className="text-slate-500 dark:text-slate-400 text-left">
            {headers.map((h, i) => (
              <th key={i} className={`font-normal pb-2 ${i === 0 ? "" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="text-slate-700 dark:text-slate-200">
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
              {row.map((cell, j) => (
                <td key={j} className={`py-1.5 tabular-nums ${j === 0 ? "" : "text-right"}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto py-12 text-center text-sm text-slate-500 dark:text-slate-400">{children}</div>
  );
}

function Forbidden() {
  return (
    <div className="max-w-3xl mx-auto py-12 text-center space-y-3">
      <p className="text-4xl">🛡️</p>
      <p className="text-slate-700 dark:text-slate-200 font-medium">沒有管理員權限</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        這個頁面只開放給 ADMIN_EMAILS 環境變數中列名的帳號。請改用既有的學生功能。
      </p>
    </div>
  );
}
