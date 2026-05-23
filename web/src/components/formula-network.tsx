"use client";

import { useCallback, useEffect, useMemo, useState, useDeferredValue } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { MarkdownRenderer } from "./markdown-renderer";
import { useTheme } from "./theme-provider";

/* ─── Types matching web/public/concepts/all-formulas.json ─── */

type Category = "mechanics" | "waves_fluid" | "thermo" | "em" | "optics";
type Kind = "formula" | "law";

interface FormulaNode {
  id: string;
  chapter: number;
  category: Category;
  label: string;
  kind: Kind;
  summary: string;
  latex: string;
  pages: number[];
}

interface FormulaEdge {
  from: string;
  to: string;
  reason: string;
  cross?: boolean;
}

interface FormulaGraphData {
  nodes: FormulaNode[];
  edges: FormulaEdge[];
}

interface CrossEdgesFile {
  edges: Array<{ from: string; to: string; reason: string; confidence: string }>;
}

const CATEGORY_STYLE: Record<Category, { label: string; bg: string; bgDark: string; border: string; text: string; dot: string }> = {
  mechanics:   { label: "力學",         bg: "#eff6ff", bgDark: "#172554", border: "#93c5fd", text: "#1e40af", dot: "#3b82f6" },
  waves_fluid: { label: "振盪、流體與波動", bg: "#ecfdf5", bgDark: "#022c22", border: "#6ee7b7", text: "#065f46", dot: "#10b981" },
  thermo:      { label: "熱學",         bg: "#fffbeb", bgDark: "#451a03", border: "#fcd34d", text: "#92400e", dot: "#f59e0b" },
  em:          { label: "電磁學",       bg: "#faf5ff", bgDark: "#3b0764", border: "#d8b4fe", text: "#6b21a8", dot: "#a855f7" },
  optics:      { label: "光學",         bg: "#fff1f2", bgDark: "#4c0519", border: "#fda4af", text: "#9f1239", dot: "#f43f5e" },
};

const CATEGORY_ORDER: Category[] = ["mechanics", "waves_fluid", "thermo", "em", "optics"];

type FormulaNodeData = {
  label: string;
  category: Category;
  chapter: number;
  selected?: boolean;
  theme: "dark" | "light";
};

function FormulaFlowNode({ data }: NodeProps<Node<FormulaNodeData>>) {
  const s = CATEGORY_STYLE[data.category];
  const isDark = data.theme === "dark";
  return (
    <div
      className="rounded-md px-2 py-1 text-[11px] font-medium border transition-all shadow-sm"
      style={{
        background: isDark ? s.bgDark : s.bg,
        borderColor: data.selected ? s.dot : s.border,
        borderWidth: data.selected ? 2 : 1,
        color: isDark ? "#e2e8f0" : s.text,
        minWidth: 110,
        maxWidth: 160,
        boxShadow: data.selected ? `0 0 0 3px ${s.dot}55` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: s.dot, width: 5, height: 5 }} />
      <div className="flex items-center gap-1">
        <span className="text-[9px] opacity-70 shrink-0">Ch{String(data.chapter).padStart(2, "0")}</span>
        <span className="leading-tight truncate">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: s.dot, width: 5, height: 5 }} />
    </div>
  );
}

const nodeTypes = { formula: FormulaFlowNode };

function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 12, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  const NODE_W = 140;
  const NODE_H = 32;

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

interface Props {
  onNavigate?: (mode: string, chapter: number) => void;
}

export function FormulaNetwork({ onNavigate }: Props) {
  const { effective: theme } = useTheme();
  const [data, setData] = useState<FormulaGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<Set<Category>>(new Set(CATEGORY_ORDER));
  const [chapterRange, setChapterRange] = useState<[number, number]>([1, 36]);
  const [searchRaw, setSearchRaw] = useState("");
  const search = useDeferredValue(searchRaw.trim().toLowerCase());
  const [showCrossEdges, setShowCrossEdges] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/concepts/all-formulas.json").then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<FormulaGraphData>;
      }),
      fetch("/concepts/cross-chapter-edges.json")
        .then((r) => (r.ok ? (r.json() as Promise<CrossEdgesFile>) : null))
        .catch(() => null),
    ])
      .then(([base, cross]) => {
        if (cancelled) return;
        if (cross) {
          const crossEdges: FormulaEdge[] = cross.edges.map((e) => ({
            from: e.from,
            to: e.to,
            reason: e.reason,
            cross: true,
          }));
          setData({ nodes: base.nodes, edges: [...base.edges, ...crossEdges] });
        } else {
          setData(base);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!data) return { initialNodes: [] as Node[], initialEdges: [] as Edge[] };

    const visible = data.nodes.filter((n) => {
      if (!categoryFilter.has(n.category)) return false;
      if (n.chapter < chapterRange[0] || n.chapter > chapterRange[1]) return false;
      if (search) {
        const hay = `${n.label} ${n.latex} ${n.summary}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    const visibleIds = new Set(visible.map((n) => n.id));

    const flowNodes: Node[] = visible.map((n) => ({
      id: n.id,
      type: "formula",
      position: { x: 0, y: 0 },
      data: { label: n.label, category: n.category, chapter: n.chapter, theme } as FormulaNodeData,
      draggable: false,
    }));

    const flowEdges: Edge[] = data.edges
      .filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to))
      .filter((e) => showCrossEdges || !e.cross)
      .map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        style: e.cross
          ? {
              stroke: theme === "dark" ? "#818cf8" : "#6366f1",
              strokeWidth: 1.5,
              strokeDasharray: "5 4",
            }
          : { stroke: theme === "dark" ? "#475569" : "#94a3b8", strokeWidth: 1 },
      }));

    const laidOut = layoutNodes(flowNodes, flowEdges);
    return { initialNodes: laidOut, initialEdges: flowEdges };
  }, [data, categoryFilter, chapterRange, search, theme, showCrossEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        data: { ...n.data, selected: n.id === selectedId } as FormulaNodeData,
      }))
    );
  }, [selectedId, setNodes]);

  const onNodeClick = useCallback((_: unknown, n: Node) => {
    setSelectedId((cur) => (cur === n.id ? null : n.id));
  }, []);

  const selectedNode = useMemo(
    () => (data && selectedId ? data.nodes.find((n) => n.id === selectedId) : null),
    [data, selectedId]
  );

  const selectedPrereqs = useMemo(() => {
    if (!data || !selectedId) return [];
    return data.edges
      .filter((e) => e.to === selectedId)
      .map((e) => ({ node: data.nodes.find((n) => n.id === e.from)!, reason: e.reason, cross: !!e.cross }))
      .filter((x) => x.node);
  }, [data, selectedId]);

  const selectedNexts = useMemo(() => {
    if (!data || !selectedId) return [];
    return data.edges
      .filter((e) => e.from === selectedId)
      .map((e) => ({ node: data.nodes.find((n) => n.id === e.to)!, reason: e.reason, cross: !!e.cross }))
      .filter((x) => x.node);
  }, [data, selectedId]);

  const categoryCounts = useMemo(() => {
    if (!data) return {} as Record<Category, number>;
    const c = {} as Record<Category, number>;
    CATEGORY_ORDER.forEach((k) => (c[k] = 0));
    data.nodes.forEach((n) => (c[n.category] = (c[n.category] ?? 0) + 1));
    return c;
  }, [data]);

  const toggleCategory = (k: Category) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <input
          type="text"
          placeholder="搜尋公式或概念..."
          value={searchRaw}
          onChange={(e) => setSearchRaw(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm w-48"
        />

        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span>章節</span>
          <input
            type="number"
            min={1}
            max={36}
            value={chapterRange[0]}
            onChange={(e) => setChapterRange([Math.max(1, Math.min(chapterRange[1], +e.target.value || 1)), chapterRange[1]])}
            className="w-14 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
          />
          <span>–</span>
          <input
            type="number"
            min={1}
            max={36}
            value={chapterRange[1]}
            onChange={(e) => setChapterRange([chapterRange[0], Math.min(36, Math.max(chapterRange[0], +e.target.value || 36))])}
            className="w-14 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORY_ORDER.map((k) => {
            const s = CATEGORY_STYLE[k];
            const active = categoryFilter.has(k);
            return (
              <button
                key={k}
                onClick={() => toggleCategory(k)}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-all"
                style={{
                  background: active ? (theme === "dark" ? s.bgDark : s.bg) : "transparent",
                  borderColor: active ? s.border : "#cbd5e1",
                  color: active ? (theme === "dark" ? "#e2e8f0" : s.text) : "#94a3b8",
                  opacity: active ? 1 : 0.5,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
                {s.label} {categoryCounts[k] ?? 0}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowCrossEdges((v) => !v)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border transition-all"
          style={{
            background: showCrossEdges ? (theme === "dark" ? "#312e81" : "#eef2ff") : "transparent",
            borderColor: showCrossEdges ? "#a5b4fc" : "#cbd5e1",
            color: showCrossEdges ? (theme === "dark" ? "#e0e7ff" : "#3730a3") : "#94a3b8",
            opacity: showCrossEdges ? 1 : 0.5,
          }}
          title="跨章節先備關係（Gemini 2.5 Pro 推理）"
        >
          <svg width="18" height="8">
            <line x1="0" y1="4" x2="18" y2="4" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          跨章邊
        </button>

        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
          {nodes.length} 顯示 / {data?.nodes.length ?? 0} 公式 · {edges.length} 邊
        </span>
      </div>

      {/* Graph + side panel */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 min-h-0">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden relative min-h-[500px]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm z-10 bg-white/70 dark:bg-slate-900/70">
              載入 591 個公式中…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-rose-500 text-sm z-10">
              載入失敗：{error}
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.05}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color={theme === "dark" ? "#1e293b" : "#e2e8f0"} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => CATEGORY_STYLE[(n.data as FormulaNodeData).category]?.dot ?? "#94a3b8"}
              style={{ background: theme === "dark" ? "#0f172a" : "#f8fafc" }}
            />
          </ReactFlow>
        </div>

        <aside className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 overflow-auto min-h-[500px] lg:max-h-none max-h-[400px]">
          {!selectedNode ? (
            <div className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed">
              全課程 591 個公式 + 定律的網路圖（Stage 1，只連同章內公式關係）。
              <div className="mt-3 text-xs">
                <p className="font-medium mb-1 text-slate-500 dark:text-slate-400">用法：</p>
                <ul className="space-y-0.5 list-disc pl-4">
                  <li>滑鼠滾輪縮放、拖曳平移</li>
                  <li>搜尋公式名稱、LaTeX 或概念</li>
                  <li>章節區間 / 類型過濾</li>
                  <li>點節點看 LaTeX + 詳情</li>
                </ul>
                <p className="mt-3 text-slate-400 dark:text-slate-500">
                  跨章節邊目前未連（Stage 1）；要加 LLM 自動推導再說。
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  {selectedNode.label}
                </h3>
                <button
                  onClick={() => setSelectedId(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm shrink-0"
                  aria-label="關閉"
                >
                  ✕
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span
                  className="px-2 py-0.5 rounded-full"
                  style={{
                    background: theme === "dark" ? CATEGORY_STYLE[selectedNode.category].bgDark : CATEGORY_STYLE[selectedNode.category].bg,
                    color: theme === "dark" ? "#e2e8f0" : CATEGORY_STYLE[selectedNode.category].text,
                  }}
                >
                  {CATEGORY_STYLE[selectedNode.category].label}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  Ch{String(selectedNode.chapter).padStart(2, "0")} · p.{selectedNode.pages.join(", ")}
                </span>
                <span className="text-slate-400 dark:text-slate-500">
                  {selectedNode.kind === "law" ? "定律" : "公式"}
                </span>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {selectedNode.summary}
              </p>

              {selectedNode.latex && (
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 overflow-x-auto">
                  <MarkdownRenderer content={`$$${selectedNode.latex}$$`} />
                </div>
              )}

              {selectedPrereqs.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    先備（{selectedPrereqs.length}）
                  </div>
                  <div className="space-y-1">
                    {selectedPrereqs.map(({ node, reason, cross }) => (
                      <button
                        key={node.id}
                        onClick={() => setSelectedId(node.id)}
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CATEGORY_STYLE[node.category].dot }} />
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            Ch{String(node.chapter).padStart(2, "0")} · {node.label}
                          </span>
                          {cross && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                              跨章
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 pl-3 leading-snug">{reason}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedNexts.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    後續（{selectedNexts.length}）
                  </div>
                  <div className="space-y-1">
                    {selectedNexts.map(({ node, reason, cross }) => (
                      <button
                        key={node.id}
                        onClick={() => setSelectedId(node.id)}
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CATEGORY_STYLE[node.category].dot }} />
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            Ch{String(node.chapter).padStart(2, "0")} · {node.label}
                          </span>
                          {cross && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                              跨章
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 pl-3 leading-snug">{reason}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {onNavigate && (
                <button
                  onClick={() => onNavigate("teaching", selectedNode.chapter)}
                  className="w-full mt-2 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  前往 Ch{String(selectedNode.chapter).padStart(2, "0")} 教學
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
