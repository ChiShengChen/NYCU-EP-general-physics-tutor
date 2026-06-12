"use client";

import { useState, useMemo } from "react";
import { useTheme, ThemeToggle } from "./theme-provider";
import { ConceptDetailGraph } from "./concept-detail-graph";
import { FormulaNetwork } from "./formula-network";
import {
  CHAPTER_NODES as NODES,
  CHAPTER_EDGES as EDGES,
  type ChapterNode as ConceptNode,
} from "@/lib/concept-graph";

/* ─── Concept Graph Data ─── */
/* NODES, EDGES, and ChapterCategory now live in `src/lib/concept-graph.ts`
 * so the API route (/api/prereq-path) and this visualization share the
 * same source of truth — adding a chapter only needs editing one file.
 * Layout positions are tuned for a 1100×940 SVG. */

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
