"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiKey } from "@/lib/api";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { useChartColors, ThemeToggle } from "./theme-provider";

/* ─── Types ─── */

interface MasteryItem {
  concept: string;
  score: number;
  attempts: number;
  misconception: string | null;
}

interface ActivityItem {
  date: string;
  count: number;
}

interface TrendItem {
  date: string;
  avgMastery: number;
}

interface Stats {
  totalMessages: number;
  totalConcepts: number;
  avgMastery: number;
  weakCount: number;
  strongCount: number;
  studySessions: number;
  totalStudyMinutes: number;
}

/* 深入分析 — mirrors the `analytics` / `classRank` keys of /api/dashboard. */

type QuestionType = "multiple_choice" | "short_answer" | "oral" | "interactive_optics";
type ErrorType = "concept" | "calculation" | "reading" | "incomplete" | "unanswered";

interface TypeAccuracy {
  type: QuestionType;
  accuracy: number;
  count: number;
}

interface ChapterAccuracy {
  chapter: number;
  title: string;
  accuracy: number;
  count: number;
}

interface ErrorTypeStats {
  counts: { type: ErrorType; count: number }[];
  analyzedAttempts: number;
  takeaway: string;
}

interface HourBucket {
  key: string;
  label: string;
  range: string;
  attempts: number;
  accuracy: number | null;
}

interface HintStats {
  hintedCount: number;
  noHintCount: number;
  hintedShare: number;
  hintedAccuracy: number | null;
  noHintAccuracy: number | null;
}

interface Analytics {
  attemptsScanned: number;
  totalQuestions: number;
  byType: TypeAccuracy[];
  byChapter: ChapterAccuracy[];
  errorTypes: ErrorTypeStats;
  byHour: HourBucket[];
  hints: HintStats;
}

interface ClassRank {
  classSize: number;
  /** null when the class is below the privacy floor (or you have no mastery yet). */
  percentile: number | null;
  yourBucket: number | null;
  histogram: number[];
}

interface DashboardData {
  mastery: MasteryItem[];
  activityHeatmap: ActivityItem[];
  trendLine: TrendItem[];
  stats: Stats;
  analytics: Analytics;
  classRank: ClassRank;
}

interface CohortChapter {
  chapter: number;
  title: string;
  cohortAccuracy: number | null;
  cohortAttempts: number | null;
  cohortStudents: number;
  yourAccuracy: number | null;
  yourAttempts: number;
}

interface CohortStats {
  windowDays: number;
  minCohortStudents: number;
  perChapter: CohortChapter[];
}

/* ─── Component ─── */

interface DashboardProps {
  onBack: () => void;
}

export function Dashboard({ onBack }: DashboardProps) {
  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("physics_tutor_student_id") ?? "";
  });

  const { data, error: fetchError, isLoading } = useSWR<DashboardData>(
    apiKey("/api/dashboard", { studentId }),
  );
  // Anonymous peer comparison — separate endpoint so dashboard's own
  // fetch isn't blocked on the cohort aggregation, and so the panel can
  // gracefully degrade when the cohort hasn't crossed the privacy floor.
  const { data: cohort } = useSWR<CohortStats>(
    apiKey("/api/cohort-stats", { studentId }),
  );

  // Distinguish "no student yet" (empty state) from "API error" (transient
  // failure to load) so the EmptyState message reads correctly to the user.
  const error = !studentId
    ? "尚未使用過系統，無學習紀錄"
    : fetchError
      ? "載入失敗"
      : null;
  const loading = !!studentId && isLoading;

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">📊</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">學習儀表板</h1>
        <button
          onClick={() => {
            if (typeof window === "undefined") return;
            const sid = localStorage.getItem("physics_tutor_student_id");
            if (!sid) return;
            // Browser-driven download: opens the API URL which returns
            // Content-Disposition: attachment so it triggers a save.
            window.location.href = `/api/export-report?studentId=${sid}`;
          }}
          className="ml-auto px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          title="把你的學習資料整理成一份 Markdown 報告下載"
        >
          📤 匯出報告
        </button>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-slate-400 dark:text-slate-500">載入中...</div>
          </div>
        ) : error ? (
          <EmptyState message={error} onBack={onBack} />
        ) : !data || data.mastery.length === 0 ? (
          <EmptyState message="還沒有學習紀錄，先去問問題或做測驗吧！" onBack={onBack} />
        ) : (
          <div className="max-w-5xl mx-auto space-y-6">
            <StatsCards stats={data.stats} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RadarSection mastery={data.mastery} />
              <TrendSection trendLine={data.trendLine} />
            </div>
            <ActivitySection activity={data.activityHeatmap} />
            {cohort && <CohortCompareSection cohort={cohort} />}
            <MasteryTable mastery={data.mastery} />
            <DeepAnalysisSection analytics={data.analytics} classRank={data.classRank} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Empty State ─── */

function EmptyState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <p className="text-4xl">📭</p>
      <p className="text-slate-500 dark:text-slate-400">{message}</p>
      <button
        onClick={onBack}
        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
      >
        返回首頁
      </button>
    </div>
  );
}

/* ─── Stats Cards ─── */

function StatsCards({ stats }: { stats: Stats }) {
  const cards = [
    { label: "平均掌握度", value: `${stats.avgMastery}%`, icon: "🎯", color: stats.avgMastery >= 70 ? "text-green-600 dark:text-green-300" : stats.avgMastery >= 40 ? "text-yellow-600 dark:text-yellow-300" : "text-red-500" },
    { label: "已學概念", value: `${stats.totalConcepts}`, icon: "📚", color: "text-indigo-600 dark:text-indigo-300" },
    { label: "薄弱概念", value: `${stats.weakCount}`, icon: "⚠️", color: stats.weakCount > 0 ? "text-amber-600 dark:text-amber-300" : "text-green-600 dark:text-green-300" },
    { label: "提問次數", value: `${stats.totalMessages}`, icon: "💬", color: "text-blue-600 dark:text-blue-300" },
    { label: "學習次數", value: `${stats.studySessions}`, icon: "📅", color: "text-purple-600 dark:text-purple-300" },
    { label: "學習時間", value: `${stats.totalStudyMinutes} 分鐘`, icon: "⏱️", color: "text-teal-600 dark:text-teal-300" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm text-center">
          <p className="text-2xl mb-1">{card.icon}</p>
          <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{card.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Radar Chart ─── */

function RadarSection({ mastery }: { mastery: MasteryItem[] }) {
  const colors = useChartColors();
  // Take top 12 concepts for the radar (too many looks cluttered)
  const radarData = mastery
    .slice(0, 12)
    .map((m) => ({
      concept: m.concept.length > 12 ? m.concept.slice(0, 12) + "…" : m.concept,
      score: m.score,
      fullMark: 100,
    }));

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">🎯 概念掌握度雷達圖</h3>
      {radarData.length < 3 ? (
        <div className="flex items-center justify-center h-64 text-slate-400 dark:text-slate-500 text-sm">
          至少需要 3 個概念才能顯示雷達圖
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke={colors.grid} />
            <PolarAngleAxis
              dataKey="concept"
              tick={{ fontSize: 10, fill: colors.axisTick }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fontSize: 9, fill: colors.axisLine }}
              tickCount={5}
            />
            <Radar
              name="掌握度"
              dataKey="score"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.25}
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/* ─── Trend Line ─── */

function TrendSection({ trendLine }: { trendLine: TrendItem[] }) {
  const colors = useChartColors();
  const displayData = trendLine.map((t) => ({
    ...t,
    date: t.date.slice(5), // MM-DD
  }));

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">📈 掌握度趨勢</h3>
      {displayData.length < 2 ? (
        <div className="flex items-center justify-center h-64 text-slate-400 dark:text-slate-500 text-sm">
          至少需要 2 天的紀錄才能顯示趨勢
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={displayData}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: colors.axisTick }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: colors.axisLine }} unit="%" />
            <Tooltip
              formatter={(value) => [`${value}%`, "平均掌握度"] as [string, string]}
              labelFormatter={(label) => `日期：${label}`}
              contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0" }}
            />
            <Line
              type="monotone"
              dataKey="avgMastery"
              stroke="#6366f1"
              strokeWidth={2.5}
              dot={{ fill: "#6366f1", r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/* ─── Activity Bar Chart ─── */

function ActivitySection({ activity }: { activity: ActivityItem[] }) {
  const colors = useChartColors();
  const displayData = activity.map((a) => ({
    ...a,
    date: a.date.slice(5),
  }));

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">📅 學習活動紀錄</h3>
      {displayData.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-400 dark:text-slate-500 text-sm">
          尚無活動紀錄
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={displayData}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: colors.axisTick }} />
            <YAxis tick={{ fontSize: 11, fill: colors.axisLine }} allowDecimals={false} />
            <Tooltip
              formatter={(value) => [`${value} 則訊息`, "活動量"] as [string, string]}
              labelFormatter={(label) => `日期：${label}`}
              contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0" }}
            />
            <Bar dataKey="count" fill="#818cf8" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/* ─── Cohort Comparison ─── */

function CohortCompareSection({ cohort }: { cohort: CohortStats }) {
  // Only show chapters where THIS student has at least one attempt AND
  // the cohort floor has been met — otherwise the row is just two empty
  // bars and adds noise. Sort by absolute gap so the most interesting
  // comparisons surface first (where you stand out either way).
  const rows = cohort.perChapter
    .filter((c) => c.yourAttempts > 0 && c.cohortAccuracy !== null)
    .map((c) => ({
      ...c,
      // Non-null narrowing for the renderer.
      cohortAccuracy: c.cohortAccuracy as number,
      yourAccuracy: c.yourAccuracy ?? 0,
      gap: (c.yourAccuracy ?? 0) - (c.cohortAccuracy as number),
    }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 12);

  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">👥 班級匿名比較</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          目前還沒有足夠的同學在你做過的章節留下資料（每章節最少需 {cohort.minCohortStudents} 人才會顯示，保護匿名性）。
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">👥 班級匿名比較</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        最近 {cohort.windowDays} 天內，你的對答率 vs 全班平均（每章節最少 {cohort.minCohortStudents} 人才入列，無從識別個人）。
      </p>
      <div className="space-y-2">
        {rows.map((c) => {
          const yourPct = Math.round(c.yourAccuracy * 100);
          const cohortPct = Math.round(c.cohortAccuracy * 100);
          const gapLabel =
            c.gap > 0.05 ? "領先" :
            c.gap < -0.05 ? "落後" :
            "持平";
          const gapTone =
            c.gap > 0.05 ? "text-emerald-700 dark:text-emerald-300" :
            c.gap < -0.05 ? "text-rose-700 dark:text-rose-300" :
            "text-slate-500 dark:text-slate-400";
          return (
            <div key={c.chapter} className="grid grid-cols-12 gap-2 items-center text-xs">
              <div className="col-span-3 truncate">
                <span className="font-mono text-slate-500 dark:text-slate-400">Ch{String(c.chapter).padStart(2, "0")}</span>
                <span className="ml-1.5 text-slate-700 dark:text-slate-200">{c.title}</span>
              </div>
              <div className="col-span-7 flex items-center gap-1">
                <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full bg-indigo-500" style={{ width: `${yourPct}%` }} />
                </div>
                <span className="tabular-nums text-indigo-700 dark:text-indigo-300 w-9 text-right">{yourPct}%</span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full bg-slate-400 dark:bg-slate-500" style={{ width: `${cohortPct}%` }} />
                </div>
                <span className="tabular-nums text-slate-500 dark:text-slate-400 w-9 text-right">{cohortPct}%</span>
              </div>
              <div className={`col-span-2 text-right tabular-nums ${gapTone}`}>
                {c.gap > 0 ? "+" : ""}{Math.round(c.gap * 100)}% {gapLabel}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" />你</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500" />班級平均</span>
      </div>
    </div>
  );
}

/* ─── Mastery Detail Table ─── */

function MasteryTable({ mastery }: { mastery: MasteryItem[] }) {
  const sorted = [...mastery].sort((a, b) => a.score - b.score);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">📋 概念掌握明細</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200 dark:border-slate-700">
              <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-300 font-semibold">概念</th>
              <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-300 font-semibold">掌握度</th>
              <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-300 font-semibold">練習次數</th>
              <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-300 font-semibold">迷思概念</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((m) => (
              <tr key={m.concept} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-200">{m.concept}</td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          m.score >= 80
                            ? "bg-green-500"
                            : m.score >= 60
                              ? "bg-yellow-500"
                              : "bg-red-500"
                        }`}
                        style={{ width: `${m.score}%` }}
                      />
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        m.score >= 80
                          ? "text-green-600 dark:text-green-300"
                          : m.score >= 60
                            ? "text-yellow-600 dark:text-yellow-300"
                            : "text-red-500"
                      }`}
                    >
                      {m.score}%
                    </span>
                  </div>
                </td>
                <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{m.attempts}</td>
                <td className="py-2 px-3 text-slate-500 dark:text-slate-400 text-xs max-w-[200px] truncate">
                  {m.misconception ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── 📊 深入分析 ─── */

/** Shared card chrome for the deep-analysis grid. */
function AnalysisCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{subtitle}</p>}
      {children}
    </div>
  );
}

function CardEmpty({ message, height = "h-48" }: { message: string; height?: string }) {
  return (
    <div className={`flex items-center justify-center ${height} text-slate-400 dark:text-slate-500 text-sm text-center px-4`}>
      {message}
    </div>
  );
}

/** Same thresholds the MasteryTable uses so "green" means the same thing
 *  everywhere on the page. */
function accuracyFill(pct: number): string {
  return pct >= 80 ? "#22c55e" : pct >= 60 ? "#eab308" : "#ef4444";
}
function accuracyText(pct: number): string {
  return pct >= 80
    ? "text-green-600 dark:text-green-300"
    : pct >= 60
      ? "text-yellow-600 dark:text-yellow-300"
      : "text-red-500";
}

const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: "選擇題",
  short_answer: "簡答題",
  oral: "口試",
  interactive_optics: "光學操作",
};

const ERROR_LABELS: Record<ErrorType, string> = {
  concept: "概念誤解",
  calculation: "計算錯誤",
  reading: "審題錯誤",
  incomplete: "回答不完整",
  unanswered: "未作答",
};
// Fixed per-entity hues (never cycled) — validated for CVD separation and
// >= 3:1 against both card surfaces.
const ERROR_COLORS: Record<ErrorType, string> = {
  concept: "#4f46e5",
  calculation: "#d97706",
  reading: "#0284c7",
  incomplete: "#9333ea",
  unanswered: "#0d9488",
};

/** Only time buckets with this many attempts are shown — fewer and the
 *  accuracy is one lucky quiz away from flipping colour. */
const MIN_HOUR_ATTEMPTS = 3;

function DeepAnalysisSection({ analytics, classRank }: { analytics: Analytics; classRank: ClassRank }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-2 pt-2">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">📊 深入分析</h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          依最近 {analytics.attemptsScanned} 次測驗 / 考試 / 口試（共 {analytics.totalQuestions} 題）
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TypeAccuracyCard byType={analytics.byType} />
        <ChapterWeaknessCard byChapter={analytics.byChapter} />
        <ErrorTypeCard errorTypes={analytics.errorTypes} />
        <HourAccuracyCard byHour={analytics.byHour} />
        <HintDependenceCard hints={analytics.hints} />
        <ClassRankCard classRank={classRank} />
      </div>
    </section>
  );
}

/* 1. 題型 × 正確率 */

function TypeAccuracyCard({ byType }: { byType: TypeAccuracy[] }) {
  const colors = useChartColors();
  const rows = byType.map((t) => ({ ...t, label: TYPE_LABELS[t.type] }));

  return (
    <AnalysisCard title="🧩 題型 × 正確率" subtitle="每種題型的答對率，括號內是題數。">
      {rows.length === 0 ? (
        <CardEmpty message="還沒有測驗紀錄" />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: colors.axisTick }}
              tickFormatter={(label: string) => {
                const r = rows.find((x) => x.label === label);
                return r ? `${label} (${r.count})` : label;
              }}
            />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: colors.axisLine }} unit="%" />
            <Tooltip
              cursor={{ fill: colors.grid, opacity: 0.4 }}
              formatter={(value, _name, item) =>
                [`${value}%（${item?.payload?.count ?? 0} 題）`, "正確率"] as [string, string]
              }
              contentStyle={{ borderRadius: 12, border: `1px solid ${colors.tooltipBorder}`, background: colors.tooltipBg, color: colors.tooltipText }}
            />
            <Bar dataKey="accuracy" radius={[6, 6, 0, 0]}>
              {rows.map((r) => (
                <Cell key={r.type} fill={accuracyFill(r.accuracy)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </AnalysisCard>
  );
}

/* 2. 章節 × 正確率（最弱 8 章） */

function ChapterWeaknessCard({ byChapter }: { byChapter: ChapterAccuracy[] }) {
  // The API already sorts weakest-first; just take the head.
  const rows = byChapter.slice(0, 8);

  return (
    <AnalysisCard title="📚 章節 × 正確率" subtitle="答對率最低的 8 章，優先複習這些。">
      {rows.length === 0 ? (
        <CardEmpty message="題目還沒標上章節，做幾份章節測驗後就會出現" />
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <div key={c.chapter} className="grid grid-cols-12 gap-2 items-center text-xs">
              <div className="col-span-4 truncate">
                <span className="font-mono text-slate-500 dark:text-slate-400">Ch{String(c.chapter).padStart(2, "0")}</span>
                {c.title && <span className="ml-1.5 text-slate-700 dark:text-slate-200">{c.title}</span>}
              </div>
              <div className="col-span-6 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${c.accuracy}%`, background: accuracyFill(c.accuracy) }} />
              </div>
              <div className="col-span-2 text-right tabular-nums">
                <span className={`font-medium ${accuracyText(c.accuracy)}`}>{c.accuracy}%</span>
                <span className="ml-1 text-slate-400 dark:text-slate-500">/{c.count}題</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </AnalysisCard>
  );
}

/* 3. 錯因分布 */

function ErrorTypeCard({ errorTypes }: { errorTypes: ErrorTypeStats }) {
  const colors = useChartColors();
  const total = errorTypes.counts.reduce((s, c) => s + c.count, 0);
  const slices = errorTypes.counts
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, label: ERROR_LABELS[c.type] }));

  return (
    <AnalysisCard
      title="🔍 錯因分布"
      subtitle={total > 0 ? `來自 ${errorTypes.analyzedAttempts} 份 AI 錯題分析，共 ${total} 題錯題。` : undefined}
    >
      {total === 0 ? (
        <CardEmpty message={errorTypes.takeaway} />
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="w-36 h-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="count"
                    nameKey="label"
                    innerRadius="58%"
                    outerRadius="100%"
                    paddingAngle={2}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {slices.map((s) => (
                      <Cell key={s.type} fill={ERROR_COLORS[s.type]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${value} 題`, String(name)] as [string, string]}
                    contentStyle={{ borderRadius: 12, border: `1px solid ${colors.tooltipBorder}`, background: colors.tooltipBg, color: colors.tooltipText }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex-1 space-y-1.5 text-xs">
              {slices.map((s) => (
                <li key={s.type} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ERROR_COLORS[s.type] }} />
                  <span className="text-slate-700 dark:text-slate-200">{s.label}</span>
                  <span className="ml-auto tabular-nums text-slate-500 dark:text-slate-400">
                    {s.count} 題 · {Math.round((s.count / total) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl px-3 py-2">
            💡 {errorTypes.takeaway}
          </p>
        </>
      )}
    </AnalysisCard>
  );
}

/* 4. 時段 × 正確率 */

function HourAccuracyCard({ byHour }: { byHour: HourBucket[] }) {
  const colors = useChartColors();
  const rows = byHour
    .filter((b) => b.attempts >= MIN_HOUR_ATTEMPTS && b.accuracy !== null)
    .map((b) => ({ ...b, accuracy: b.accuracy as number, axis: `${b.label} ${b.range}` }));

  return (
    <AnalysisCard title="🕐 時段 × 正確率" subtitle={`你在一天哪個時段答得最好（台北時間；每時段至少 ${MIN_HOUR_ATTEMPTS} 次測驗才計）。`}>
      {rows.length === 0 ? (
        <CardEmpty message={`每個時段累積 ${MIN_HOUR_ATTEMPTS} 次測驗後就能比較`} />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
            <XAxis dataKey="axis" tick={{ fontSize: 11, fill: colors.axisTick }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: colors.axisLine }} unit="%" />
            <Tooltip
              cursor={{ fill: colors.grid, opacity: 0.4 }}
              formatter={(value, _name, item) =>
                [`${value}%（${item?.payload?.attempts ?? 0} 次測驗）`, "正確率"] as [string, string]
              }
              contentStyle={{ borderRadius: 12, border: `1px solid ${colors.tooltipBorder}`, background: colors.tooltipBg, color: colors.tooltipText }}
            />
            <Bar dataKey="accuracy" radius={[6, 6, 0, 0]}>
              {rows.map((r) => (
                <Cell key={r.key} fill={accuracyFill(r.accuracy)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </AnalysisCard>
  );
}

/* 5. 提示依賴 */

function HintDependenceCard({ hints }: { hints: HintStats }) {
  const total = hints.hintedCount + hints.noHintCount;
  const gap =
    hints.hintedAccuracy !== null && hints.noHintAccuracy !== null
      ? hints.hintedAccuracy - hints.noHintAccuracy
      : null;
  const verdict =
    total === 0 ? null :
    hints.hintedShare >= 50 ? "超過一半的題目用了提示——試著先自己想 2 分鐘再開提示。" :
    gap !== null && gap < -15 ? "用提示的題反而答得比較差——提示通常出現在你本來就不穩的題，這些是弱點。" :
    gap !== null && gap > 15 ? "提示對你很有效，而且用得節制，可以繼續這樣用。" :
    "提示用得不多，答對率也穩定，不太依賴提示。";

  return (
    <AnalysisCard title="💡 提示依賴" subtitle="選擇 / 簡答題中用了提示的比例，以及用與不用的答對率差異。">
      {total === 0 ? (
        <CardEmpty message="還沒有可以提示的題目" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-center">
              <p className="text-xl font-bold text-indigo-600 dark:text-indigo-300">{hints.hintedShare}%</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">用了提示</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">{hints.hintedCount} / {total} 題</p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-center">
              <p className={`text-xl font-bold ${hints.hintedAccuracy === null ? "text-slate-400" : accuracyText(hints.hintedAccuracy)}`}>
                {hints.hintedAccuracy === null ? "—" : `${hints.hintedAccuracy}%`}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">有提示答對率</p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-center">
              <p className={`text-xl font-bold ${hints.noHintAccuracy === null ? "text-slate-400" : accuracyText(hints.noHintAccuracy)}`}>
                {hints.noHintAccuracy === null ? "—" : `${hints.noHintAccuracy}%`}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">無提示答對率</p>
            </div>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
            <div className="h-full bg-indigo-500" style={{ width: `${hints.hintedShare}%` }} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" />用了提示</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700" />沒用提示</span>
          </div>
          {verdict && <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">{verdict}</p>}
        </>
      )}
    </AnalysisCard>
  );
}

/* 6. 班級百分位 */

function ClassRankCard({ classRank }: { classRank: ClassRank }) {
  const colors = useChartColors();

  if (classRank.percentile === null) {
    return (
      <AnalysisCard title="🏅 班級百分位">
        <CardEmpty
          height="h-32"
          message={
            classRank.classSize > 0 && classRank.yourBucket === null && classRank.classSize >= 5
              ? "做過測驗、有掌握度紀錄後才能比較"
              : "班上同學再多一點就能比較（至少 5 位同學有測驗紀錄才會顯示，保護匿名性）"
          }
        />
      </AnalysisCard>
    );
  }

  // 「前 N%」 reads better than 「贏過 N%」 — flip the percentile.
  const topPct = Math.max(1, 100 - classRank.percentile);
  const rows = classRank.histogram.map((count, i) => ({
    bucket: i,
    label: `${i * 10}`,
    count,
    mine: i === classRank.yourBucket,
  }));

  return (
    <AnalysisCard
      title="🏅 班級百分位"
      subtitle={`全班 ${classRank.classSize} 位同學的平均掌握度分布；只顯示你的相對位置，不顯示任何人的名字。`}
    >
      <p className="text-sm text-slate-700 dark:text-slate-200 mb-2">
        你的掌握度在全班<span className="mx-1 text-lg font-bold text-indigo-600 dark:text-indigo-300">前 {topPct}%</span>
      </p>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={rows} barCategoryGap="12%">
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: colors.axisTick }}
            tickFormatter={(v: string) => `${v}%`}
            interval={0}
          />
          <YAxis tick={{ fontSize: 10, fill: colors.axisLine }} allowDecimals={false} width={28} />
          <Tooltip
            cursor={{ fill: colors.grid, opacity: 0.4 }}
            formatter={(value, _name, item) =>
              [`${value} 人${item?.payload?.mine ? "（含你）" : ""}`, "同學數"] as [string, string]
            }
            labelFormatter={(label) => `掌握度 ${label}–${Number(label) + 10}%`}
            contentStyle={{ borderRadius: 12, border: `1px solid ${colors.tooltipBorder}`, background: colors.tooltipBg, color: colors.tooltipText }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.bucket} fill={r.mine ? "#6366f1" : colors.axisLine} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" />你所在的區間</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500" />其他同學</span>
      </div>
    </AnalysisCard>
  );
}
