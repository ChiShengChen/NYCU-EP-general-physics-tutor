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
} from "recharts";
import { useChartColors } from "./theme-provider";

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

interface DashboardData {
  mastery: MasteryItem[];
  activityHeatmap: ActivityItem[];
  trendLine: TrendItem[];
  stats: Stats;
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
            <MasteryTable mastery={data.mastery} />
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
