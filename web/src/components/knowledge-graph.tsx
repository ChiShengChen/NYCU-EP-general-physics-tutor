"use client";

import { useState, useMemo } from "react";
import { useTheme, ThemeToggle } from "./theme-provider";
import { ConceptDetailGraph } from "./concept-detail-graph";
import { FormulaNetwork } from "./formula-network";

/* ─── Concept Graph Data ─── */
/* Categories:
 *   mechanics      — Ch01–Ch12
 *   waves_fluid    — Ch13–Ch16  (SHM, fluids, mechanical waves, sound)
 *   thermo         — Ch17–Ch20
 *   em             — Ch21–Ch32  (electric, magnetic, AC, EM waves)
 *   optics         — Ch33–Ch36  (light propagation, geometric, interference, diffraction)
 * Layout positions are tuned for a 1100×820 SVG; adjust freely. */

interface ConceptNode {
  id: string;
  label: string;
  chapter: number;
  category: "mechanics" | "waves_fluid" | "thermo" | "em" | "optics" | "modern";
  x: number;
  y: number;
}

interface ConceptEdge {
  from: string;
  to: string;
}

const NODES: ConceptNode[] = [
  // Mechanics — row 1 (Ch01–Ch08)
  { id: "ch01", label: "向量與單位", chapter: 1, category: "mechanics", x: 90, y: 60 },
  { id: "ch02", label: "1D 運動學", chapter: 2, category: "mechanics", x: 230, y: 60 },
  { id: "ch03", label: "2D/3D 運動", chapter: 3, category: "mechanics", x: 370, y: 60 },
  { id: "ch04", label: "牛頓運動定律", chapter: 4, category: "mechanics", x: 510, y: 60 },
  { id: "ch05", label: "牛頓定律應用", chapter: 5, category: "mechanics", x: 650, y: 60 },
  { id: "ch06", label: "功與動能", chapter: 6, category: "mechanics", x: 790, y: 60 },
  { id: "ch07", label: "位能與能量守恆", chapter: 7, category: "mechanics", x: 930, y: 60 },
  // Mechanics — row 2 (Ch08–Ch12)
  { id: "ch08", label: "動量與碰撞", chapter: 8, category: "mechanics", x: 90, y: 160 },
  { id: "ch09", label: "剛體轉動", chapter: 9, category: "mechanics", x: 230, y: 160 },
  { id: "ch10", label: "轉動動力學", chapter: 10, category: "mechanics", x: 370, y: 160 },
  { id: "ch11", label: "靜力平衡", chapter: 11, category: "mechanics", x: 510, y: 160 },
  { id: "ch12", label: "重力", chapter: 12, category: "mechanics", x: 650, y: 160 },

  // Waves & Fluid — row 3 (Ch13–Ch16)
  { id: "ch13", label: "簡諧運動", chapter: 13, category: "waves_fluid", x: 90, y: 280 },
  { id: "ch14", label: "流體力學", chapter: 14, category: "waves_fluid", x: 230, y: 280 },
  { id: "ch15", label: "機械波", chapter: 15, category: "waves_fluid", x: 370, y: 280 },
  { id: "ch16", label: "聲學", chapter: 16, category: "waves_fluid", x: 510, y: 280 },

  // Thermodynamics — row 4 (Ch17–Ch20)
  { id: "ch17", label: "溫度與熱", chapter: 17, category: "thermo", x: 90, y: 400 },
  { id: "ch18", label: "理想氣體", chapter: 18, category: "thermo", x: 230, y: 400 },
  { id: "ch19", label: "熱力學第一定律", chapter: 19, category: "thermo", x: 370, y: 400 },
  { id: "ch20", label: "熱力學第二定律", chapter: 20, category: "thermo", x: 510, y: 400 },

  // EM — row 5 (Ch21–Ch26)
  { id: "ch21", label: "電荷與電場", chapter: 21, category: "em", x: 90, y: 520 },
  { id: "ch22", label: "高斯定律", chapter: 22, category: "em", x: 230, y: 520 },
  { id: "ch23", label: "電位", chapter: 23, category: "em", x: 370, y: 520 },
  { id: "ch24", label: "電容與介電質", chapter: 24, category: "em", x: 510, y: 520 },
  { id: "ch25", label: "電流與電阻", chapter: 25, category: "em", x: 650, y: 520 },
  { id: "ch26", label: "直流電路", chapter: 26, category: "em", x: 790, y: 520 },
  // EM — row 6 (Ch27–Ch32)
  { id: "ch27", label: "磁場與磁力", chapter: 27, category: "em", x: 90, y: 640 },
  { id: "ch28", label: "磁場來源", chapter: 28, category: "em", x: 230, y: 640 },
  { id: "ch29", label: "電磁感應", chapter: 29, category: "em", x: 370, y: 640 },
  { id: "ch30", label: "電感", chapter: 30, category: "em", x: 510, y: 640 },
  { id: "ch31", label: "交流電路", chapter: 31, category: "em", x: 650, y: 640 },
  { id: "ch32", label: "電磁波", chapter: 32, category: "em", x: 790, y: 640 },

  // Optics — row 7 (Ch33–Ch36)
  { id: "ch33", label: "光的傳播", chapter: 33, category: "optics", x: 90, y: 760 },
  { id: "ch34", label: "幾何光學", chapter: 34, category: "optics", x: 230, y: 760 },
  { id: "ch35", label: "干涉", chapter: 35, category: "optics", x: 370, y: 760 },
  { id: "ch36", label: "繞射", chapter: 36, category: "optics", x: 510, y: 760 },

  // Modern physics — row 8 (Ch37+)
  { id: "ch37", label: "相對論", chapter: 37, category: "modern", x: 90, y: 880 },
];

const EDGES: ConceptEdge[] = [
  // Mechanics chain
  { from: "ch01", to: "ch02" },
  { from: "ch02", to: "ch03" },
  { from: "ch03", to: "ch04" },
  { from: "ch04", to: "ch05" },
  { from: "ch04", to: "ch06" },
  { from: "ch06", to: "ch07" },
  { from: "ch04", to: "ch08" },
  { from: "ch07", to: "ch08" },
  { from: "ch03", to: "ch09" },
  { from: "ch09", to: "ch10" },
  { from: "ch04", to: "ch10" },
  { from: "ch10", to: "ch11" },
  { from: "ch04", to: "ch12" },
  // Waves / fluid
  { from: "ch07", to: "ch13" },
  { from: "ch04", to: "ch14" },
  { from: "ch13", to: "ch15" },
  { from: "ch15", to: "ch16" },
  // Thermo
  { from: "ch17", to: "ch18" },
  { from: "ch17", to: "ch19" },
  { from: "ch18", to: "ch19" },
  { from: "ch19", to: "ch20" },
  // EM
  { from: "ch21", to: "ch22" },
  { from: "ch21", to: "ch23" },
  { from: "ch22", to: "ch23" },
  { from: "ch23", to: "ch24" },
  { from: "ch23", to: "ch25" },
  { from: "ch25", to: "ch26" },
  { from: "ch24", to: "ch26" },
  { from: "ch25", to: "ch27" },
  { from: "ch27", to: "ch28" },
  { from: "ch27", to: "ch29" },
  { from: "ch29", to: "ch30" },
  { from: "ch30", to: "ch31" },
  { from: "ch26", to: "ch31" },
  // EM waves draw on Faraday's law (induction) and AC oscillation
  { from: "ch29", to: "ch32" },
  { from: "ch31", to: "ch32" },
  // Optics — EM waves form the basis of light; geometric optics → wave optics
  { from: "ch32", to: "ch33" },
  { from: "ch33", to: "ch34" },
  { from: "ch33", to: "ch35" },
  { from: "ch15", to: "ch35" },
  { from: "ch35", to: "ch36" },
  // Special relativity: builds on EM-wave / light invariance (Ch32) and
  // the relativistic energy story extends mechanical energy (Ch07).
  { from: "ch32", to: "ch37" },
  { from: "ch07", to: "ch37" },
];

const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string; label: string; svgFill: string; svgStroke: string; svgFillSelected: string; svgStrokeSelected: string }> = {
  mechanics:   { bg: "bg-blue-50 dark:bg-blue-950/30",    border: "border-blue-300 dark:border-blue-700",    text: "text-blue-700 dark:text-blue-300",    label: "力學",            svgFill: "#eff6ff", svgStroke: "#93c5fd", svgFillSelected: "#dbeafe", svgStrokeSelected: "#3b82f6" },
  waves_fluid: { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-300 dark:border-emerald-700", text: "text-emerald-700 dark:text-emerald-300", label: "振盪、流體與波動", svgFill: "#ecfdf5", svgStroke: "#6ee7b7", svgFillSelected: "#d1fae5", svgStrokeSelected: "#10b981" },
  thermo:      { bg: "bg-amber-50 dark:bg-amber-950/30",   border: "border-amber-300 dark:border-amber-700",   text: "text-amber-700 dark:text-amber-300",   label: "熱學",            svgFill: "#fffbeb", svgStroke: "#fcd34d", svgFillSelected: "#fef3c7", svgStrokeSelected: "#f59e0b" },
  em:          { bg: "bg-purple-50 dark:bg-purple-950/30",  border: "border-purple-300 dark:border-purple-700",  text: "text-purple-700 dark:text-purple-300",  label: "電磁學",          svgFill: "#faf5ff", svgStroke: "#d8b4fe", svgFillSelected: "#f3e8ff", svgStrokeSelected: "#a855f7" },
  optics:      { bg: "bg-rose-50 dark:bg-rose-950/30",      border: "border-rose-300 dark:border-rose-700",      text: "text-rose-700 dark:text-rose-300",      label: "光學",            svgFill: "#fff1f2", svgStroke: "#fda4af", svgFillSelected: "#ffe4e6", svgStrokeSelected: "#f43f5e" },
  modern:      { bg: "bg-slate-50 dark:bg-slate-900",       border: "border-slate-400 dark:border-slate-600",     text: "text-slate-700 dark:text-slate-200",   label: "近代物理",        svgFill: "#f8fafc", svgStroke: "#cbd5e1", svgFillSelected: "#e2e8f0", svgStrokeSelected: "#475569" },
};

const CATEGORY_ORDER: Array<ConceptNode["category"]> = ["mechanics", "waves_fluid", "thermo", "em", "optics", "modern"];

/* ─── Component ─── */

interface KnowledgeGraphProps {
  onBack: () => void;
  onNavigate?: (mode: string, chapter: number) => void;
}

export function KnowledgeGraph({ onBack, onNavigate }: KnowledgeGraphProps) {
  const [tab, setTab] = useState<"overview" | "detail" | "formulas">("overview");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const { effective: theme } = useTheme();
  // Node label / sub-label colors flip in dark mode so they stay readable
  // on slate-900 backgrounds inside the card.
  const nodeTextColor = theme === "dark" ? "#e2e8f0" : "#334155";
  const nodeSubColor = theme === "dark" ? "#94a3b8" : "#94a3b8";

  const nodeMap = useMemo(() => {
    const m = new Map<string, ConceptNode>();
    NODES.forEach((n) => m.set(n.id, n));
    return m;
  }, []);

  const connectedNodes = useMemo(() => {
    const active = hoveredNode ?? selectedNode;
    if (!active) return new Set<string>();
    const connected = new Set<string>([active]);
    EDGES.forEach((e) => {
      if (e.from === active) connected.add(e.to);
      if (e.to === active) connected.add(e.from);
    });
    return connected;
  }, [hoveredNode, selectedNode]);

  const selectedNodeData = selectedNode ? nodeMap.get(selectedNode) : null;

  const svgWidth = 1100;
  const svgHeight = 940;

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
        <span className="text-xl">🧠</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">概念知識圖譜</h1>

        <div className="ml-3 flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
          <button
            onClick={() => setTab("overview")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === "overview"
                ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            章節總覽
          </button>
          <button
            onClick={() => setTab("detail")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === "detail"
                ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            細節圖譜
          </button>
          <button
            onClick={() => setTab("formulas")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === "formulas"
                ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            公式網路
          </button>
        </div>

        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">NYCU 電物系 · 普通物理</span>
        <ThemeToggle />
      </header>

      {tab === "detail" ? (
        <div className="flex-1 overflow-hidden px-4 py-4 min-h-0">
          <ConceptDetailGraph onNavigate={onNavigate} />
        </div>
      ) : tab === "formulas" ? (
        <div className="flex-1 overflow-hidden px-4 py-4 min-h-0">
          <FormulaNetwork onNavigate={onNavigate} />
        </div>
      ) : (
      <div className="flex-1 overflow-auto px-4 py-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 justify-center">
            {Object.entries(CATEGORY_COLORS).map(([key, val]) => (
              <div key={key} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded-full ${val.bg} border ${val.border}`} />
                <span className="text-xs text-slate-600 dark:text-slate-300">{val.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <svg width="20" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#arrowhead-legend)" /><defs><marker id="arrowhead-legend" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><polygon points="0 0, 6 2, 0 4" fill="#94a3b8" /></marker></defs></svg>
              <span className="text-xs text-slate-600 dark:text-slate-300">先修關係</span>
            </div>
          </div>

          {/* ── Desktop: SVG Graph ── */}
          <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full"
              style={{ maxHeight: "70vh" }}
            >
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
                </marker>
                <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#6366f1" />
                </marker>
              </defs>

              {EDGES.map((edge) => {
                const from = nodeMap.get(edge.from)!;
                const to = nodeMap.get(edge.to)!;
                const active = hoveredNode ?? selectedNode;
                const isActive = active && (edge.from === active || edge.to === active);

                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const offsetStart = 55;
                const offsetEnd = 55;
                const x1 = from.x + (dx / len) * offsetStart;
                const y1 = from.y + (dy / len) * offsetStart;
                const x2 = to.x - (dx / len) * offsetEnd;
                const y2 = to.y - (dy / len) * offsetEnd;

                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isActive ? "#6366f1" : "#cbd5e1"}
                    strokeWidth={isActive ? 2.5 : 1.5}
                    markerEnd={isActive ? "url(#arrowhead-active)" : "url(#arrowhead)"}
                    opacity={active && !isActive ? 0.2 : 1}
                    className="transition-all duration-200"
                  />
                );
              })}

              {NODES.map((node) => {
                const active = hoveredNode ?? selectedNode;
                const isHighlighted = !active || connectedNodes.has(node.id);
                const isSelected = selectedNode === node.id;
                const palette = CATEGORY_COLORS[node.category];

                return (
                  <g
                    key={node.id}
                    onClick={() => setSelectedNode(isSelected ? null : node.id)}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    className="cursor-pointer"
                    opacity={isHighlighted ? 1 : 0.25}
                  >
                    <rect
                      x={node.x - 56}
                      y={node.y - 22}
                      width={112}
                      height={44}
                      rx={12}
                      fill={isSelected ? palette.svgFillSelected : palette.svgFill}
                      stroke={isSelected ? palette.svgStrokeSelected : palette.svgStroke}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      className="transition-all duration-200"
                    />
                    <text
                      x={node.x}
                      y={node.y - 3}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill={nodeTextColor}
                    >
                      {node.label}
                    </text>
                    <text
                      x={node.x}
                      y={node.y + 13}
                      textAnchor="middle"
                      fontSize={9}
                      fill={nodeSubColor}
                    >
                      Ch{String(node.chapter).padStart(2, "0")}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* ── Mobile: Card-based list ── */}
          <div className="md:hidden space-y-4">
            {CATEGORY_ORDER.map((cat) => {
              const colors = CATEGORY_COLORS[cat];
              const catNodes = NODES.filter((n) => n.category === cat);
              return (
                <div key={cat} className={`${colors.bg} border ${colors.border} rounded-2xl p-4`}>
                  <h3 className={`text-sm font-semibold ${colors.text} mb-3`}>{colors.label}</h3>
                  <div className="space-y-2">
                    {catNodes.map((node) => {
                      const isSelected = selectedNode === node.id;
                      const prereqs = EDGES.filter((e) => e.to === node.id).map((e) => nodeMap.get(e.from)!);
                      const nexts = EDGES.filter((e) => e.from === node.id).map((e) => nodeMap.get(e.to)!);
                      return (
                        <button
                          key={node.id}
                          onClick={() => setSelectedNode(isSelected ? null : node.id)}
                          className={`w-full text-left rounded-xl px-4 py-3 transition-all duration-200 ${
                            isSelected
                              ? "bg-white dark:bg-slate-900 ring-2 ring-indigo-400 shadow-sm"
                              : "bg-white/70 hover:bg-white dark:bg-slate-900"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-slate-800 dark:text-slate-100 text-sm">{node.label}</span>
                            <span className="text-xs text-slate-400 dark:text-slate-500">Ch{String(node.chapter).padStart(2, "0")}</span>
                          </div>
                          {isSelected && (
                            <div className="mt-2 space-y-1.5 text-xs">
                              {prereqs.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="text-slate-500 dark:text-slate-400">先修：</span>
                                  {prereqs.map((n) => (
                                    <span
                                      key={n.id}
                                      onClick={(e) => { e.stopPropagation(); setSelectedNode(n.id); }}
                                      className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-100 dark:bg-indigo-900/40 hover:text-indigo-700 dark:text-indigo-300 cursor-pointer"
                                    >
                                      {n.label}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {nexts.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="text-slate-500 dark:text-slate-400">後續：</span>
                                  {nexts.map((n) => (
                                    <span
                                      key={n.id}
                                      onClick={(e) => { e.stopPropagation(); setSelectedNode(n.id); }}
                                      className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-100 dark:bg-indigo-900/40 hover:text-indigo-700 dark:text-indigo-300 cursor-pointer"
                                    >
                                      {n.label}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {prereqs.length === 0 && nexts.length === 0 && (
                                <span className="text-slate-400 dark:text-slate-500">獨立概念</span>
                              )}
                              {onNavigate && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onNavigate("teaching", node.chapter); }}
                                  className="mt-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
                                >
                                  前往 Ch{String(node.chapter).padStart(2, "0")} 教學
                                </button>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected node detail — desktop only */}
          {selectedNodeData && (
            <div className={`hidden md:block ${CATEGORY_COLORS[selectedNodeData.category].bg} border ${CATEGORY_COLORS[selectedNodeData.category].border} rounded-2xl p-5`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-base font-semibold ${CATEGORY_COLORS[selectedNodeData.category].text}`}>
                  {selectedNodeData.label}
                </h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">Ch{String(selectedNodeData.chapter).padStart(2, "0")}</span>
              </div>

              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <div>
                  <span className="font-medium">先修概念：</span>
                  {EDGES.filter((e) => e.to === selectedNodeData.id).length === 0 ? (
                    <span className="text-slate-400 dark:text-slate-500">無（起始概念）</span>
                  ) : (
                    EDGES.filter((e) => e.to === selectedNodeData.id).map((e) => {
                      const n = nodeMap.get(e.from)!;
                      return (
                        <button
                          key={e.from}
                          onClick={() => setSelectedNode(e.from)}
                          className="inline-block ml-1 px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs hover:border-indigo-300 dark:border-indigo-700 transition-colors"
                        >
                          {n.label}
                        </button>
                      );
                    })
                  )}
                </div>

                <div>
                  <span className="font-medium">後續概念：</span>
                  {EDGES.filter((e) => e.from === selectedNodeData.id).length === 0 ? (
                    <span className="text-slate-400 dark:text-slate-500">無（終端概念）</span>
                  ) : (
                    EDGES.filter((e) => e.from === selectedNodeData.id).map((e) => {
                      const n = nodeMap.get(e.to)!;
                      return (
                        <button
                          key={e.to}
                          onClick={() => setSelectedNode(e.to)}
                          className="inline-block ml-1 px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs hover:border-indigo-300 dark:border-indigo-700 transition-colors"
                        >
                          {n.label}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {onNavigate && (
                <button
                  onClick={() => onNavigate("teaching", selectedNodeData.chapter)}
                  className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  前往 Ch{String(selectedNodeData.chapter).padStart(2, "0")} 教學
                </button>
              )}
            </div>
          )}

          {/* Instructions */}
          {!selectedNode && (
            <div className="text-center text-sm text-slate-400 dark:text-slate-500 pb-4">
              點擊任一概念節點查看詳情與先後關係
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
