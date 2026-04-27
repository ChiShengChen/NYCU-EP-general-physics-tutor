"use client";

interface ModeSelectorProps {
  onSelectMode: (mode: "teaching" | "qa" | "quiz" | "exam" | "graph" | "study-plan" | "dashboard" | "history" | "attempts") => void;
}

export function ModeSelector({ onSelectMode }: ModeSelectorProps) {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <span className="text-xl">🔬</span>
        <h1 className="text-lg font-semibold text-slate-800">普通物理 AI 助教</h1>
        <span className="text-xs text-slate-400 ml-auto">NYCU 電物系 · 楊本立老師</span>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center mb-10">
          <p className="text-3xl mb-3">👋</p>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">歡迎使用普通物理 AI 助教</h2>
          <p className="text-slate-500">請選擇學習模式</p>
        </div>

        {/* Top row: 3 main learning modes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl w-full mb-5">
          <button
            onClick={() => onSelectMode("teaching")}
            className="group flex flex-col items-center text-center p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">📖</span>
            <h3 className="text-lg font-semibold text-slate-800 mb-1.5">教學模式</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              按照講義逐頁學習，AI 為你解說內容
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              開始學習
            </span>
          </button>

          <button
            onClick={() => onSelectMode("qa")}
            className="group flex flex-col items-center text-center p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">💬</span>
            <h3 className="text-lg font-semibold text-slate-800 mb-1.5">自由問答</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              自由提問普通物理問題，AI 根據教材回答
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              開始提問
            </span>
          </button>

          <button
            onClick={() => onSelectMode("quiz")}
            className="group flex flex-col items-center text-center p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">📝</span>
            <h3 className="text-lg font-semibold text-slate-800 mb-1.5">自動測驗</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              AI 根據薄弱概念自動生成測驗
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              開始測驗
            </span>
          </button>
        </div>

        {/* Middle row: 3 advanced features */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl w-full mb-5">
          <button
            onClick={() => onSelectMode("exam")}
            className="group flex flex-col items-center text-center p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">🎓</span>
            <h3 className="text-lg font-semibold text-slate-800 mb-1.5">考試模擬</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              限時模擬期中期末考，交卷後統一批改
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              模擬考試
            </span>
          </button>

          <button
            onClick={() => onSelectMode("graph")}
            className="group flex flex-col items-center text-center p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">🧠</span>
            <h3 className="text-lg font-semibold text-slate-800 mb-1.5">概念圖譜</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              視覺化概念先後關係，點擊跳轉教學
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              探索圖譜
            </span>
          </button>

          <button
            onClick={() => onSelectMode("study-plan")}
            className="group flex flex-col items-center text-center p-6 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-1 transition-all duration-200 cursor-pointer"
          >
            <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">📅</span>
            <h3 className="text-lg font-semibold text-slate-800 mb-1.5">AI 學習計畫</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              遺忘曲線複習提醒 + 個人化學習計畫
            </p>
            <span className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium group-hover:bg-indigo-700 transition-colors">
              查看計畫
            </span>
          </button>
        </div>

        {/* Bottom row: 3 utility modes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl w-full">
          <button
            onClick={() => onSelectMode("dashboard")}
            className="group flex flex-row items-center text-left p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">📊</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800">學習儀表板</h3>
              <p className="text-xs text-slate-500 mt-0.5">掌握度雷達圖、學習趨勢與統計</p>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("attempts")}
            className="group flex flex-row items-center text-left p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">📚</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800">測驗紀錄</h3>
              <p className="text-xs text-slate-500 mt-0.5">回顧每次測驗 / 考試的對錯與 AI 回饋</p>
            </div>
          </button>

          <button
            onClick={() => onSelectMode("history")}
            className="group flex flex-row items-center text-left p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer gap-4"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform shrink-0">🕒</span>
            <div>
              <h3 className="text-base font-semibold text-slate-800">對話歷史</h3>
              <p className="text-xs text-slate-500 mt-0.5">回顧過去的提問與 AI 回答</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
