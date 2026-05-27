"use client";

import useSWR from "swr";
import { apiKey } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { useDailyStatus } from "./daily-review";
import { ThemeToggle } from "./theme-provider";
import { UsageWidget } from "./usage-widget";
import { AuthButton } from "./auth-button";

type HomeStats = {
  attemptsCount: number;
  avgAccuracy: number | null;
  reviewedConcepts: number;
  avgMastery: number | null;
  dailyDueCount: number;
};

interface ModeSelectorProps {
  onSelectMode: (mode: "teaching" | "qa" | "quiz" | "exam" | "graph" | "study-plan" | "dashboard" | "history" | "attempts" | "wrong" | "preview" | "feynman" | "calibration" | "daily" | "compare" | "reflection" | "library" | "goals" | "sim") => void;
}

function StatPill({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2">
      <span className="text-2xl">{emoji}</span>
      <div className="min-w-0">
        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{label}</div>
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</div>
      </div>
    </div>
  );
}

/** Small keyboard shortcut indicator. The number lines up with the global
 *  1–9 handler in app/page.tsx so power users learn the binding by sight. */
function KbdBadge({ k }: { k: string }) {
  return (
    <kbd className="absolute top-2 right-2 hidden lg:inline-flex items-center justify-center w-5 h-5 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-[10px] font-mono text-slate-500 dark:text-slate-400">
      {k}
    </kbd>
  );
}

export function ModeSelector({ onSelectMode }: ModeSelectorProps) {
  // Read studentId from localStorage via useSyncExternalStore so the daily
  // banner can show today's status + streak for this browser's anonymous
  // student profile, without tripping React 19's set-state-in-effect rule.
  const studentId = useStudentId();
  const { todayDone, streak } = useDailyStatus(studentId);

  // Homepage headline numbers — single small API call. Goes through SWR
  // so a quick mode → back trip uses the cached payload instead of
  // re-hitting the API.
  const { data: stats } = useSWR<HomeStats>(apiKey("/api/home-stats", { studentId }));

  return (
    <div className="flex flex-col min-h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <span className="text-xl">🔬</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">普通物理 AI 助教</h1>
        <div className="ml-auto flex items-center gap-2">
          <AuthButton />
          <ThemeToggle />
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500 hidden lg:inline">NYCU 電物系 · 楊本立老師</span>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center mb-6">
          <p className="text-3xl mb-3">👋</p>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">歡迎使用普通物理 AI 助教</h2>
          <p className="text-slate-500 dark:text-slate-400">請選擇學習模式</p>
        </div>

        {/* Compact stats strip — only renders once we have any signal. */}
        {stats && (stats.attemptsCount > 0 || stats.reviewedConcepts > 0) && (
          <div className="w-full max-w-5xl mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatPill emoji="🧪" label="完成測驗" value={`${stats.attemptsCount} 份`} />
            <StatPill emoji="🎯" label="平均答對率" value={stats.avgAccuracy !== null ? `${stats.avgAccuracy}%` : "—"} />
            <StatPill emoji="🧠" label="練過的概念" value={`${stats.reviewedConcepts} 個`} />
            <StatPill emoji="📈" label="平均掌握度" value={stats.avgMastery !== null ? `${stats.avgMastery}%` : "—"} />
          </div>
        )}

        <UsageWidget studentId={studentId} />

        {/* Daily review banner: visible reminder + one-click entry to today's
            spaced-repetition session. Visual treatment swaps between
            「待完成」(amber) and 「已完成」(emerald) so a returning student can
            see at a glance whether today's habit is checked off. */}
        <button
          onClick={() => onSelectMode("daily")}
          className={`relative w-full max-w-5xl mb-6 flex items-center gap-4 text-left p-4 rounded-2xl border shadow-sm hover:shadow-md transition-all ${
            todayDone
              ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 hover:border-emerald-300 dark:border-emerald-700"
              : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 hover:border-amber-300 dark:border-amber-700"
          }`}
        >
          <KbdBadge k="9" />
          <span className="text-3xl shrink-0">📅</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
              {todayDone ? "今日 5 分鐘已完成 ✓" : "今日 5 分鐘小複習"}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {todayDone
                ? "明天再來，保持連續紀錄。"
                : "AI 從你的錯題裡，依遺忘曲線挑出最該再看的 3–5 題，現在花 5 分鐘搞定。"}
            </div>
          </div>
          {streak > 0 && (
            <div className="shrink-0 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-xs">
              🔥 連續 <strong className="text-amber-700 dark:text-amber-300">{streak}</strong> 天
            </div>
          )}
          <span className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium text-white ${todayDone ? "bg-emerald-600" : "bg-amber-600"}`}>
            {todayDone ? "再做一次" : "開始 →"}
          </span>
        </button>

        {/* Top row: 4 main learning modes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-5xl w-full mb-5">
          <button
            onClick={() => onSelectMode("preview")}
            className="group relative flex flex-col items-center text-center p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <KbdBadge k="1" />
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">🔭</span>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1.5">章節預習</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              5–7 張概念卡，1 分鐘掃完一章重點
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              快速 overview
            </span>
          </button>

          <button
            onClick={() => onSelectMode("teaching")}
            className="group relative flex flex-col items-center text-center p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <KbdBadge k="2" />
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">📖</span>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1.5">教學模式</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              按照講義逐頁學習，AI 為你解說內容
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              開始學習
            </span>
          </button>

          <button
            onClick={() => onSelectMode("qa")}
            className="group relative flex flex-col items-center text-center p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <KbdBadge k="3" />
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">💬</span>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1.5">自由問答</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              自由提問普通物理問題，AI 根據教材回答
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              開始提問
            </span>
          </button>

          <button
            onClick={() => onSelectMode("quiz")}
            className="group relative flex flex-col items-center text-center p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <KbdBadge k="4" />
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">📝</span>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1.5">自動測驗</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              AI 根據薄弱概念或單一章節出題
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              開始測驗
            </span>
          </button>
        </div>

        {/* Middle row: 4 advanced features */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-5xl w-full mb-5">
          <button
            onClick={() => onSelectMode("feynman")}
            className="group relative flex flex-col items-center text-center p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-amber-300 dark:border-amber-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <KbdBadge k="5" />
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">🎓</span>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1.5">教 AI（費曼法）</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              你來教 AI 學弟妹，他會挑模糊點追問
            </p>
            <span className="px-5 py-2 rounded-xl bg-amber-600 text-white text-sm font-medium group-hover:bg-amber-700 transition-colors">
              開始教學
            </span>
          </button>

          <button
            onClick={() => onSelectMode("exam")}
            className="group relative flex flex-col items-center text-center p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <KbdBadge k="6" />
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">📋</span>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1.5">考試模擬</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              限時模擬期中期末考，交卷後統一批改
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              模擬考試
            </span>
          </button>

          <button
            onClick={() => onSelectMode("graph")}
            className="group relative flex flex-col items-center text-center p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <KbdBadge k="7" />
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">🧠</span>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1.5">概念圖譜</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              視覺化概念先後關係，點擊跳轉教學
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              探索圖譜
            </span>
          </button>

          <button
            onClick={() => onSelectMode("study-plan")}
            className="group relative flex flex-col items-center text-center p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <KbdBadge k="8" />
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">📅</span>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1.5">AI 學習計畫</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              遺忘曲線複習提醒 + 個人化學習計畫
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              查看計畫
            </span>
          </button>
        </div>

        {/* Interactive simulators banner — calls attention to the new
            Batch 3 sandbox without crowding the existing 4-col grids. */}
        <button
          onClick={() => onSelectMode("sim")}
          className="w-full max-w-5xl mb-5 flex items-center gap-4 text-left p-4 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 transition-all"
        >
          <span className="text-3xl shrink-0">🔬</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
              互動模擬器 <span className="text-[10px] font-normal text-indigo-600 dark:text-indigo-300 ml-1">NEW</span>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              自由落體 · 彈簧 SHM · RC 電路。滑桿即時調參，看 g、k、τ 怎麼改變現象。
            </div>
          </div>
          <span className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
            進入沙盒 →
          </span>
        </button>

        {/* Learning-support row: tools that aren't a full study session,
            but help students clarify, look up, plan or reflect. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-5xl w-full mb-5">
          <button
            onClick={() => onSelectMode("goals")}
            className="group flex flex-row items-center text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">🎯</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">學習目標</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">設定本週目標，自動追蹤進度</p>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("compare")}
            className="group flex flex-row items-center text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">🔗</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">概念對比</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">選兩個概念 → AI 生並列對比表</p>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("library")}
            className="group flex flex-row items-center text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">📝</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">例題庫 / 公式速查</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">關鍵字搜尋例題與公式</p>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("reflection")}
            className="group flex flex-row items-center text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-amber-300 dark:border-amber-700 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">🪞</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">反思日誌</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">每週 3 句反思 + AI 回饋</p>
            </div>
          </button>
        </div>

        {/* Bottom row: 5 utility modes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 max-w-6xl w-full">
          <button
            onClick={() => onSelectMode("dashboard")}
            className="group flex flex-row items-center text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">📊</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">學習儀表板</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">掌握度雷達圖、學習趨勢與統計</p>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("calibration")}
            className="group flex flex-row items-center text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-amber-300 dark:border-amber-700 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">🎯</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">信心校準</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">「自信高但答錯」= 你真正的迷思</p>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("attempts")}
            className="group flex flex-row items-center text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">📚</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">測驗紀錄</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">回顧每次測驗 / 考試的對錯與 AI 回饋</p>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("wrong")}
            className="group flex flex-row items-center text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-rose-300 dark:border-rose-700 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">📕</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">錯題本</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">所有答錯題目集中複習，依章節篩選</p>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("history")}
            className="group flex flex-row items-center text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">🕒</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">對話歷史</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">回顧過去的提問與 AI 回答</p>
            </div>
          </button>
        </div>

        <p className="hidden lg:flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-8 text-[11px] text-slate-400 dark:text-slate-500">
          <span>💡 快捷鍵：</span>
          <span><kbd className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 font-mono">1</kbd>–<kbd className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 font-mono">9</kbd> 切換模式</span>
          <span><kbd className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 font-mono">Esc</kbd> 返回首頁</span>
          <span><kbd className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 font-mono">⌘/Ctrl</kbd>+<kbd className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 font-mono">Enter</kbd> 送出</span>
        </p>
      </div>
    </div>
  );
}
