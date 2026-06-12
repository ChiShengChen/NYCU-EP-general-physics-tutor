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
  topStudents: { id: string | null; label: string; isAuthenticated: boolean; calls: number; totalTokens: number; costUsd: number }[];
  endpoints: { endpoint: string; calls: number; totalTokens: number; costUsd: number }[];
  daily: { date: string; tokens: number; costUsd: number }[];
}

interface StudentDetail {
  windowDays: number;
  profile: {
    id: string;
    email: string | null;
    displayName: string | null;
    createdAt: string;
    lastSignedInAt: string | null;
  } | null;
  totals: { calls: number; totalTokens: number; costUsd: number };
  daily: { date: string; tokens: number; calls: number; costUsd: number }[];
  endpoints: { endpoint: string; calls: number; tokens: number; costUsd: number }[];
  chatSessions: {
    sessionId: string | null;
    startedAt: string;
    lastAt: string;
    messageCount: number;
    firstUserMessage: string | null;
  }[];
  attempts: {
    id: number;
    kind: "quiz" | "exam";
    examType: string | null;
    title: string;
    totalScore: number;
    maxScore: number;
    grade: string | null;
    createdAt: string;
  }[];
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  chunks_used: number[] | null;
  created_at: string;
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

/**
 * Anchor styled as a small button. We use a real <a> so the browser
 * streams the CSV directly via its download UI — wrapping fetch() and
 * blob URLs would also work but would pull the whole CSV into memory
 * just to re-export it.
 */
function DownloadCsvButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1"
      title="下載 CSV（UTF-8 BOM，Excel 直接打開不會亂碼）"
    >
      ⬇ {children}
    </a>
  );
}

/* ─── Usage tab ─── */

const STUDENTS_PER_PAGE = 25;
const RANGE_OPTIONS = [
  { label: "7 天", value: "7" },
  { label: "30 天", value: "30" },
  { label: "90 天", value: "90" },
  { label: "全部", value: "all" },
] as const;
type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];

function UsageView() {
  const [range, setRange] = useState<RangeValue>("30");
  const { data, error, isLoading } = useSWR<UsageData>(apiKey("/api/admin/usage", { days: range }));
  // Which row is expanded into a per-student detail drawer. We render
  // the drawer inline under the table rather than as a modal so admins
  // can keep scrolling through other rows without losing context.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Pagination for the student usage table. 1-indexed because that's
  // what the page selector shows the admin.
  const [studentsPage, setStudentsPage] = useState(1);

  if (isLoading) return <Centered>載入中...</Centered>;
  if (error) {
    const status = (error as { status?: number })?.status;
    if (status === 403) return <Forbidden />;
    return <Centered>讀取失敗：{String(error)}</Centered>;
  }
  if (!data) return null;

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.tokens));
  const totalStudents = data.topStudents.length;
  const totalPages = Math.max(1, Math.ceil(totalStudents / STUDENTS_PER_PAGE));
  const safePage = Math.min(studentsPage, totalPages);
  const pageStart = (safePage - 1) * STUDENTS_PER_PAGE;
  const pageStudents = data.topStudents.slice(pageStart, pageStart + STUDENTS_PER_PAGE);
  const selectedStudent = data.topStudents.find((s) => s.id && s.id === selectedId) ?? null;

  // Friendly label for headers / file names. windowDays=0 is the
  // "all-time" sentinel the route returns when ?days=all.
  const rangeLabel = data.windowDays === 0 ? "全部" : `${data.windowDays} 天`;
  const exportDays = range === "all" ? "365" : range;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 dark:text-slate-400">時間區間：</span>
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => {
              setRange(o.value);
              setStudentsPage(1);
              setSelectedId(null);
            }}
            className={`px-2.5 py-1 rounded-lg border text-xs ${
              range === o.value
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
          >
            {o.label}
          </button>
        ))}
        <div className="ml-auto">
          <DownloadCsvButton href={`/api/admin/export/usage?days=${exportDays}`}>
            匯出全班 CSV（{rangeLabel}）
          </DownloadCsvButton>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="呼叫總數" value={String(data.totals.calls)} />
        <Stat label={`Tokens (${rangeLabel})`} value={fmtTokens(data.totals.totalTokens)} />
        <Stat label="估算成本" value={fmtCost(data.totals.costUsd)} emphasis />
        <Stat label="活躍學生" value={String(data.totals.distinctStudents)} />
      </div>

      <Section title={`📈 每日 Tokens（${rangeLabel}）`}>
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

      <Section title={`🔝 學生用量排行（共 ${totalStudents} 人，第 ${safePage} / ${totalPages} 頁）`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[420px]">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400 text-left">
                <th className="font-normal pb-2">學生</th>
                <th className="font-normal pb-2 text-right">次數</th>
                <th className="font-normal pb-2 text-right">Tokens</th>
                <th className="font-normal pb-2 text-right">估算成本</th>
              </tr>
            </thead>
            <tbody className="text-slate-700 dark:text-slate-200">
              {pageStudents.map((s, i) => {
                const clickable = !!s.id;
                const isOpen = clickable && s.id === selectedId;
                return (
                  <tr
                    key={i}
                    onClick={() => clickable && setSelectedId(isOpen ? null : s.id!)}
                    className={`border-t border-slate-100 dark:border-slate-800 ${
                      clickable ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60" : ""
                    } ${isOpen ? "bg-indigo-50 dark:bg-indigo-950/30" : ""}`}
                    title={clickable ? "點擊查看每日 tokens / 對話 / 測驗紀錄" : "已刪除帳號 — 無法查看明細"}
                  >
                    <td className="py-1.5">
                      <span className="truncate inline-block max-w-[260px] align-middle">
                        {clickable && <span className="text-slate-400 mr-1">{isOpen ? "▾" : "▸"}</span>}
                        {s.label}{" "}
                        {!s.isAuthenticated && s.id && (
                          <span className="text-[10px] text-slate-400">匿名</span>
                        )}
                      </span>
                    </td>
                    <td className="py-1.5 tabular-nums text-right">{s.calls}</td>
                    <td className="py-1.5 tabular-nums text-right">{fmtTokens(s.totalTokens)}</td>
                    <td className="py-1.5 tabular-nums text-right">{fmtCost(s.costUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onChange={(p) => {
              setStudentsPage(p);
              // Close the drilldown when jumping pages — the previously
              // selected row probably isn't on this page anymore, and
              // leaving a phantom drawer dangling between pages is
              // disorienting.
              setSelectedId(null);
            }}
          />
        )}

        {selectedStudent?.id && (
          <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-4">
            <StudentDetail id={selectedStudent.id} label={selectedStudent.label} />
          </div>
        )}
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

/* ─── Per-student drilldown ─── */

function StudentDetail({ id, label }: { id: string; label: string }) {
  const { data, error, isLoading } = useSWR<StudentDetail>(apiKey("/api/admin/student", { id }));

  if (isLoading) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">載入 {label} 明細中...</p>;
  }
  if (error) {
    return <p className="text-xs text-rose-500">讀取明細失敗：{String(error)}</p>;
  }
  if (!data) return null;

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.tokens));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600 dark:text-slate-300">
        <span className="font-medium text-slate-800 dark:text-slate-100">{label}</span>
        {data.profile?.createdAt && (
          <span className="text-slate-400 dark:text-slate-500">
            註冊 {new Date(data.profile.createdAt).toLocaleDateString("zh-TW")}
          </span>
        )}
        {data.profile?.lastSignedInAt && (
          <span className="text-slate-400 dark:text-slate-500">
            · 最近登入 {new Date(data.profile.lastSignedInAt).toLocaleDateString("zh-TW")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <DownloadCsvButton href={`/api/admin/export/student?id=${id}&kind=usage&days=${data.windowDays}`}>
            usage
          </DownloadCsvButton>
          <DownloadCsvButton href={`/api/admin/export/student?id=${id}&kind=chats`}>
            chats
          </DownloadCsvButton>
          <DownloadCsvButton href={`/api/admin/export/student?id=${id}&kind=attempts`}>
            attempts
          </DownloadCsvButton>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="呼叫" value={String(data.totals.calls)} />
        <MiniStat label="Tokens" value={fmtTokens(data.totals.totalTokens)} />
        <MiniStat label="成本" value={fmtCost(data.totals.costUsd)} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
          📅 每日 Tokens（最近 {data.windowDays} 天）
        </h3>
        {data.daily.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">這位學生 30 天內沒有 token 使用紀錄</p>
        ) : (
          <>
            <div className="flex items-end gap-1 h-20">
              {data.daily.map((d) => {
                const h = Math.max(2, (d.tokens / maxDaily) * 72);
                return (
                  <div
                    key={d.date}
                    className="flex-1 bg-emerald-500 dark:bg-emerald-400 rounded-t"
                    style={{ height: `${h}px` }}
                    title={`${d.date}: ${d.tokens.toLocaleString()} tokens · ${d.calls} 次 · ${fmtCost(d.costUsd)}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              <span>{data.daily[0]?.date}</span>
              <span>{data.daily[data.daily.length - 1]?.date}</span>
            </div>
          </>
        )}
      </div>

      {data.endpoints.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">🔀 端點分布</h3>
          <Table
            headers={["端點", "次數", "Tokens", "成本"]}
            rows={data.endpoints.slice(0, 12).map((e) => [
              <span key="0" className="font-mono text-[10px]">{e.endpoint}</span>,
              String(e.calls),
              fmtTokens(e.tokens),
              fmtCost(e.costUsd),
            ])}
          />
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
          💬 自由問答 session（最近 {data.chatSessions.length} 場）
        </h3>
        {data.chatSessions.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">沒有對話紀錄</p>
        ) : (
          <ul className="space-y-1.5">
            {data.chatSessions.map((s) => (
              <ChatSessionRow key={s.sessionId ?? "__legacy__"} studentId={id} session={s} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
          📝 測驗紀錄（最近 {data.attempts.length} 場）
        </h3>
        {data.attempts.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">沒有測驗紀錄</p>
        ) : (
          <Table
            headers={["類型", "標題", "分數", "日期"]}
            rows={data.attempts.map((a) => [
              <span key="0" className="font-mono text-[10px]">
                {a.kind === "exam" ? `考試·${a.examType ?? ""}` : "練習"}
              </span>,
              <span key="1" className="truncate inline-block max-w-[220px] align-middle">{a.title || "—"}</span>,
              <span key="2">
                {a.totalScore.toFixed(1)} / {a.maxScore.toFixed(0)}
                {a.grade && <span className="ml-1 text-[10px] text-slate-400">({a.grade})</span>}
              </span>,
              <span key="3" className="text-[10px] text-slate-400">
                {new Date(a.createdAt).toLocaleDateString("zh-TW")}
              </span>,
            ])}
          />
        )}
      </div>
    </div>
  );
}

function ChatSessionRow({
  studentId,
  session,
}: {
  studentId: string;
  session: StudentDetail["chatSessions"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const sessionKey = session.sessionId ?? "__legacy__";
  const { data, isLoading } = useSWR<{ messages: ChatMessage[] }>(
    expanded ? apiKey("/api/admin/student/chat", { id: studentId, session: sessionKey }) : null,
  );

  return (
    <li className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2 text-xs flex items-start gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl"
      >
        <span className="text-slate-400 mt-0.5">{expanded ? "▾" : "▸"}</span>
        <span className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              {new Date(session.startedAt).toLocaleString("zh-TW")}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">· {session.messageCount} 則</span>
            {session.sessionId === null && (
              <span className="text-[10px] text-slate-400 dark:text-slate-500">· 舊版資料</span>
            )}
          </div>
          <div className="text-slate-700 dark:text-slate-200 line-clamp-2">
            {session.firstUserMessage ?? "(無內容)"}
          </div>
        </span>
      </button>
      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2 space-y-2 max-h-96 overflow-y-auto">
          {isLoading && <p className="text-[10px] text-slate-400">載入訊息中...</p>}
          {data?.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg p-2 text-xs ${
                m.role === "user"
                  ? "bg-indigo-50 dark:bg-indigo-950/40"
                  : "bg-slate-50 dark:bg-slate-800/60"
              }`}
            >
              <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                {m.role === "user" ? "👤 學生" : "🤖 AI"}
                <span className="ml-2">{new Date(m.created_at).toLocaleTimeString("zh-TW")}</span>
              </div>
              <div className="text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words">
                {m.content.slice(0, 4000)}
                {m.content.length > 4000 && <span className="text-slate-400">…(已截斷)</span>}
              </div>
            </div>
          ))}
          {data?.messages.length === 0 && (
            <p className="text-[10px] text-slate-400">這個 session 沒有訊息</p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Compact 1-N page selector with windowed page numbers. Shows prev/next
 * arrows, the first page, an ellipsis, a small window around the current
 * page, another ellipsis, and the last page. Keeps the row short even
 * when there are 50+ pages.
 */
function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pages = buildPageWindow(page, totalPages);
  return (
    <div className="mt-4 flex items-center justify-center gap-1 text-xs flex-wrap">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ‹ 上一頁
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-slate-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`min-w-[28px] px-2 py-1 rounded-lg border tabular-nums ${
              p === page
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        下一頁 ›
      </button>
    </div>
  );
}

/**
 * Build a list like [1, "…", 4, 5, 6, "…", 20] for the current page.
 * Always includes 1 and totalPages; pads up to ±2 around `page`; collapses
 * the rest with ellipses.
 */
function buildPageWindow(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 2);
  const end = Math.min(totalPages - 1, page + 2);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < totalPages - 1) out.push("…");
  out.push(totalPages);
  return out;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
      <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{value}</div>
    </div>
  );
}

/* ─── Reports tab ─── */

function ReportsView() {
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  // Which report card has the student-drilldown drawer open underneath
  // it. One at a time keeps the panel readable when the moderator is
  // scrolling a long queue.
  const [expandedReportId, setExpandedReportId] = useState<number | null>(null);
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
        <DownloadCsvButton href={`/api/admin/export/reports?status=${status}`}>
          匯出 CSV
        </DownloadCsvButton>
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
                {r.student_id ? (
                  <button
                    onClick={() =>
                      setExpandedReportId((curr) => (curr === r.id ? null : r.id))
                    }
                    className={`ml-auto text-[10px] px-2 py-0.5 rounded-full border ${
                      expandedReportId === r.id
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                    title="點擊查看這位學生的 token / 對話 / 測驗紀錄"
                  >
                    {expandedReportId === r.id ? "▾" : "▸"} 學生 {r.student_id.slice(0, 8)}
                  </button>
                ) : (
                  <span className="ml-auto text-[10px] text-slate-400">匿名</span>
                )}
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

              {expandedReportId === r.id && r.student_id && (
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <StudentDetail id={r.student_id} label={`學生 ${r.student_id.slice(0, 8)}`} />
                </div>
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
