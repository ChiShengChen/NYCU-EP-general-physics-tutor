"use client";

import { useState, useEffect } from "react";
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
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("physics_tutor_student_id") ?? "";
  });

  useEffect(() => {
    if (!studentId) {
      setError("尚未使用過系統，無學習紀錄");
      setLoading(false);
      return;
    }

    fetch(`/api/dashboard?studentId=${studentId}`)
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError("載入失敗");
        setLoading(false);
      });
  }, [studentId]);

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">📊</span>
        <h1 className="text-lg font-semibold text-slate-800">學習儀表板</h1>
        <span className="text-xs text-slate-400 ml-auto">NYCU 電物系</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-slate-400">載入中...</div>
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
      <p className="text-slate-500">{message}</p>
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
    { label: "平均掌握度", value: `${stats.avgMastery}%`, icon: "🎯", color: stats.avgMastery >= 70 ? "text-green-600" : stats.avgMastery >= 40 ? "text-yellow-600" : "text-red-500" },
    { label: "已學概念", value: `${stats.totalConcepts}`, icon: "📚", color: "text-indigo-600" },
    { label: "薄弱概念", value: `${stats.weakCount}`, icon: "⚠️", color: stats.weakCount > 0 ? "text-amber-600" : "text-green-600" },
    { label: "提問次數", value: `${stats.totalMessages}`, icon: "💬", color: "text-blue-600" },
    { label: "學習次數", value: `${stats.studySessions}`, icon: "📅", color: "text-purple-600" },
    { label: "學習時間", value: `${stats.totalStudyMinutes} 分鐘`, icon: "⏱️", color: "text-teal-600" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm text-center">
          <p className="text-2xl mb-1">{card.icon}</p>
          <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
          <p className="text-xs text-slate-500 mt-1">{card.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Radar Chart ─── */

function RadarSection({ mastery }: { mastery: MasteryItem[] }) {
  // Take top 12 concepts for the radar (too many looks cluttered)
  const radarData = mastery
    .slice(0, 12)
    .map((m) => ({
      concept: m.concept.length > 12 ? m.concept.slice(0, 12) + "…" : m.concept,
      score: m.score,
      fullMark: 100,
    }));

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">🎯 概念掌握度雷達圖</h3>
      {radarData.length < 3 ? (
        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
          至少需要 3 個概念才能顯示雷達圖
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis
              dataKey="concept"
              tick={{ fontSize: 10, fill: "#64748b" }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fontSize: 9, fill: "#94a3b8" }}
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
  const displayData = trendLine.map((t) => ({
    ...t,
    date: t.date.slice(5), // MM-DD
  }));

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">📈 掌握度趨勢</h3>
      {displayData.length < 2 ? (
        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
          至少需要 2 天的紀錄才能顯示趨勢
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={displayData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} unit="%" />
            <Tooltip
              formatter={(value: number | string | undefined) => [`${value}%`, "平均掌握度"]}
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
  const displayData = activity.map((a) => ({
    ...a,
    date: a.date.slice(5),
  }));

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">📅 學習活動紀錄</h3>
      {displayData.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          尚無活動紀錄
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={displayData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
            <Tooltip
              formatter={(value: number | string | undefined) => [`${value} 則訊息`, "活動量"]}
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
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">📋 概念掌握明細</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left py-2 px-3 text-slate-600 font-semibold">概念</th>
              <th className="text-left py-2 px-3 text-slate-600 font-semibold">掌握度</th>
              <th className="text-left py-2 px-3 text-slate-600 font-semibold">練習次數</th>
              <th className="text-left py-2 px-3 text-slate-600 font-semibold">迷思概念</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((m) => (
              <tr key={m.concept} className="hover:bg-slate-50 transition-colors">
                <td className="py-2 px-3 font-medium text-slate-700">{m.concept}</td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
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
                          ? "text-green-600"
                          : m.score >= 60
                            ? "text-yellow-600"
                            : "text-red-500"
                      }`}
                    >
                      {m.score}%
                    </span>
                  </div>
                </td>
                <td className="py-2 px-3 text-slate-500">{m.attempts}</td>
                <td className="py-2 px-3 text-slate-500 text-xs max-w-[200px] truncate">
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
