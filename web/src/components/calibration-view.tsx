"use client";

/* 信心校準 (Confidence calibration) — visualises whether the student's
 * self-rated confidence matches their actual accuracy, and surfaces:
 *   - high-confidence wrong answers   (likely misconceptions)
 *   - low-confidence right answers    (knew it, but lacked confidence) */

import useSWR from "swr";
import { apiKey } from "@/lib/api";
import { useStudentId } from "@/lib/use-student-id";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend } from "recharts";
import { useChartColors, ThemeToggle } from "./theme-provider";

interface Bucket {
  confidence: number;
  total: number;
  correct: number;
  accuracy: number;
}

interface Flagged {
  attemptId: number;
  attemptTitle: string;
  attemptCreatedAt: string;
  questionId: number;
  concept: string;
  sourceChapter: number | null;
  questionPreview: string;
  confidence: number;
}

interface CalibrationData {
  totalAnswered: number;
  totalWithConfidence: number;
  buckets: Bucket[];
  dangerous: Flagged[];
  shaky: Flagged[];
}

const BUCKET_COLORS: Record<number, string> = {
  1: "#f43f5e", 2: "#f97316", 3: "#f59e0b", 4: "#84cc16", 5: "#10b981",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

interface CalibrationViewProps {
  onBack: () => void;
}

export function CalibrationView({ onBack }: CalibrationViewProps) {
  const studentId = useStudentId() ?? "";
  const { data, isLoading } = useSWR<CalibrationData>(
    apiKey("/api/calibration", { studentId }),
  );
  const loading = !!studentId && isLoading;

  const colors = useChartColors();

  // Build comparison series for the line chart: ideal (perfect calibration)
  // vs. actual accuracy. Perfect calibration ≈ (conf 1: 20%, 2: 40%, 3: 60%, 4: 80%, 5: 100%).
  const ideal = [
    { confidence: 1, ideal: 20, actual: 0 },
    { confidence: 2, ideal: 40, actual: 0 },
    { confidence: 3, ideal: 60, actual: 0 },
    { confidence: 4, ideal: 80, actual: 0 },
    { confidence: 5, ideal: 100, actual: 0 },
  ];
  if (data) {
    for (const b of data.buckets) {
      const row = ideal.find((r) => r.confidence === b.confidence);
      if (row) row.actual = b.accuracy;
    }
  }

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
        <span className="text-xl">🎯</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">信心校準</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
          {data ? `已記錄 ${data.totalWithConfidence}/${data.totalAnswered} 題` : ""}
        </span>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {loading ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-12">載入中...</div>
          ) : !data || data.totalWithConfidence === 0 ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-12">
              <p className="text-3xl mb-2">📊</p>
              <p>還沒有信心評分資料</p>
              <p className="text-xs mt-1">在「自動測驗」或「考試模擬」答題前，先選一下「我有多確定」，這裡就會出現校準分析。</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                💡 <strong>信心校準</strong>是後設認知（metacognition）訓練的核心：你「以為懂的」和「真的懂的」差距，就是你還需要補強的地方。
                <strong>理想狀況</strong>下，自信 5 的題正確率應該接近 100%、自信 1 的題接近隨機。
                若你的自信 4–5 卻常答錯，可能藏著危險的迷思。
              </p>

              {/* Bucket bar chart */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">各信心等級的實際正確率</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.buckets}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                    <XAxis dataKey="confidence" tick={{ fontSize: 11, fill: colors.axisTick }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: colors.axisLine }} unit="%" />
                    <Tooltip
                      formatter={(value, name) =>
                        name === "accuracy"
                          ? ([`${value}%`, "正確率"] as [string, string])
                          : ([String(value), "題數"] as [string, string])
                      }
                      labelFormatter={(label) => `信心 ${label}`}
                    />
                    <Bar dataKey="accuracy" radius={[6, 6, 0, 0]}>
                      {data.buckets.map((b) => (
                        <Cell key={b.confidence} fill={BUCKET_COLORS[b.confidence]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex justify-around text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                  {data.buckets.map((b) => (
                    <span key={b.confidence}>{b.total > 0 ? `n=${b.total}` : "—"}</span>
                  ))}
                </div>
              </div>

              {/* Ideal vs actual */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">你的校準線 vs 理想線</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={ideal}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                    <XAxis dataKey="confidence" tick={{ fontSize: 11, fill: colors.axisTick }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: colors.axisLine }} unit="%" />
                    <Tooltip formatter={(v) => [`${v}%`, ""] as [string, string]} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Line dataKey="ideal"  name="理想"  stroke="#94a3b8" strokeDasharray="4 4" dot={false} />
                    <Line dataKey="actual" name="你的"  stroke="#6366f1" strokeWidth={2.5} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  你的線若在理想線<strong>上方</strong> = 自信「過低」（其實會但沒信心）；
                  在<strong>下方</strong> = 自信「過高」（以為懂但其實沒）。
                </p>
              </div>

              {/* Dangerous misconceptions */}
              <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 rounded-2xl p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-rose-700 dark:text-rose-300 mb-2">⚠️ 危險迷思（高自信卻答錯）</h2>
                {data.dangerous.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500 py-3 text-center">目前沒有 — 很棒！</p>
                ) : (
                  <ul className="space-y-2">
                    {data.dangerous.map((f) => (
                      <li key={`d-${f.attemptId}-${f.questionId}`} className="text-xs">
                        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-0.5">
                          <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-medium">自信 {f.confidence}</span>
                          {f.sourceChapter && <span>Ch{String(f.sourceChapter).padStart(2, "0")}</span>}
                          {f.concept && <span className="truncate">{f.concept}</span>}
                          <span className="ml-auto">{formatDate(f.attemptCreatedAt)}</span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-200 line-clamp-2">{f.questionPreview}{f.questionPreview.length >= 80 ? "..." : ""}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Underconfident wins */}
              <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-2">💪 其實你會（低自信卻答對）</h2>
                {data.shaky.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500 py-3 text-center">沒記錄 — 答題時不妨大膽一點！</p>
                ) : (
                  <ul className="space-y-2">
                    {data.shaky.map((f) => (
                      <li key={`s-${f.attemptId}-${f.questionId}`} className="text-xs">
                        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-0.5">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium">自信 {f.confidence}</span>
                          {f.sourceChapter && <span>Ch{String(f.sourceChapter).padStart(2, "0")}</span>}
                          {f.concept && <span className="truncate">{f.concept}</span>}
                          <span className="ml-auto">{formatDate(f.attemptCreatedAt)}</span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-200 line-clamp-2">{f.questionPreview}{f.questionPreview.length >= 80 ? "..." : ""}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
