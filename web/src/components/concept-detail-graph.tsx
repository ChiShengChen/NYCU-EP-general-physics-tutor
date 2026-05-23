"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

/* ─── Types matching parsed_lectures/Ch{N}.concepts.json ─── */

type Kind = "concept" | "definition" | "formula" | "law" | "principle" | "method";

interface ConceptNode {
  id: string;
  label: string;
  kind: Kind;
  summary: string;
  latex: string;
  pages: number[];
}

interface ConceptEdge {
  from: string;
  to: string;
  reason: string;
}

interface ChapterData {
  chapter_number: number;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}

/* ─── Chapter titles (mirror knowledge-graph.tsx NODES) ─── */

const CHAPTER_TITLES: Record<number, string> = {
  1: "向量與單位", 2: "1D 運動學", 3: "2D/3D 運動", 4: "牛頓運動定律",
  5: "牛頓定律應用", 6: "功與動能", 7: "位能與能量守恆", 8: "動量與碰撞",
  9: "剛體轉動", 10: "轉動動力學", 11: "靜力平衡", 12: "重力",
  13: "簡諧運動", 14: "流體力學", 15: "機械波", 16: "聲學",
  17: "溫度與熱", 18: "理想氣體", 19: "熱力學第一定律", 20: "熱力學第二定律",
  21: "電荷與電場", 22: "高斯定律", 23: "電位", 24: "電容與介電質",
  25: "電流與電阻", 26: "直流電路", 27: "磁場與磁力", 28: "磁場來源",
  29: "電磁感應", 30: "電感", 31: "交流電路", 32: "電磁波",
  33: "光的傳播", 34: "幾何光學", 35: "干涉", 36: "繞射",
};

/* ─── Per-kind palette ─── */

const KIND_STYLE: Record<Kind, { label: string; bg: string; bgDark: string; border: string; text: string; dot: string }> = {
  concept:    { label: "概念", bg: "#eef2ff", bgDark: "#1e1b4b", border: "#a5b4fc", text: "#3730a3", dot: "#6366f1" },
  definition: { label: "定義", bg: "#ecfeff", bgDark: "#083344", border: "#67e8f9", text: "#0e7490", dot: "#06b6d4" },
  formula:    { label: "公式", bg: "#fef3c7", bgDark: "#451a03", border: "#fcd34d", text: "#92400e", dot: "#f59e0b" },
  law:        { label: "定律", bg: "#fee2e2", bgDark: "#450a0a", border: "#fca5a5", text: "#991b1b", dot: "#ef4444" },
  principle:  { label: "原理", bg: "#fae8ff", bgDark: "#3b0764", border: "#d8b4fe", text: "#6b21a8", dot: "#a855f7" },
  method:     { label: "方法", bg: "#d1fae5", bgDark: "#022c22", border: "#6ee7b7", text: "#065f46", dot: "#10b981" },
};

const KIND_ORDER: Kind[] = ["concept", "definition", "formula", "law", "principle", "method"];

/* ─── Custom node ─── */

type ConceptNodeData = { label: string; kind: Kind; selected?: boolean; theme: "dark" | "light" };

function ConceptFlowNode({ data }: NodeProps<Node<ConceptNodeData>>) {
  const s = KIND_STYLE[data.kind];
  const isDark = data.theme === "dark";
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs font-medium border-2 transition-all shadow-sm"
      style={{
        background: isDark ? s.bgDark : s.bg,
        borderColor: data.selected ? s.dot : s.border,
        color: isDark ? "#e2e8f0" : s.text,
        minWidth: 120,
        maxWidth: 180,
        boxShadow: data.selected ? `0 0 0 3px ${s.dot}55` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: s.dot, width: 6, height: 6 }} />
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
        <span className="leading-tight">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: s.dot, width: 6, height: 6 }} />
    </div>
  );
}

const nodeTypes = { concept: ConceptFlowNode };

/* ─── Layout via dagre ─── */

function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  const NODE_W = 160;
  const NODE_H = 40;

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

/* ─── Component ─── */

interface Props {
  initialChapter?: number;
  onNavigate?: (mode: string, chapter: number) => void;
}

export function ConceptDetailGraph({ initialChapter = 1, onNavigate }: Props) {
  const { effective: theme } = useTheme();
  const [chapter, setChapter] = useState<number>(initialChapter);
  const [data, setData] = useState<ChapterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<Set<Kind>>(new Set(KIND_ORDER));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    fetch(`/concepts/Ch${String(chapter).padStart(2, "0")}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: ChapterData) => {
        if (!cancelled) setData(j);
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
  }, [chapter]);

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!data) return { initialNodes: [] as Node[], initialEdges: [] as Edge[] };

    const visible = data.nodes.filter((n) => kindFilter.has(n.kind));
    const visibleIds = new Set(visible.map((n) => n.id));

    const flowNodes: Node[] = visible.map((n) => ({
      id: n.id,
      type: "concept",
      position: { x: 0, y: 0 },
      data: { label: n.label, kind: n.kind, theme } as ConceptNodeData,
    }));

    const flowEdges: Edge[] = data.edges
      .filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to))
      .map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        animated: false,
        style: { stroke: theme === "dark" ? "#475569" : "#94a3b8", strokeWidth: 1.5 },
      }));

    const laidOut = layoutNodes(flowNodes, flowEdges);
    return { initialNodes: laidOut, initialEdges: flowEdges };
  }, [data, kindFilter, theme]);

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
        data: { ...n.data, selected: n.id === selectedId } as ConceptNodeData,
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
      .map((e) => ({ node: data.nodes.find((n) => n.id === e.from)!, reason: e.reason }))
      .filter((x) => x.node);
  }, [data, selectedId]);

  const selectedNexts = useMemo(() => {
    if (!data || !selectedId) return [];
    return data.edges
      .filter((e) => e.from === selectedId)
      .map((e) => ({ node: data.nodes.find((n) => n.id === e.to)!, reason: e.reason }))
      .filter((x) => x.node);
  }, [data, selectedId]);

  const kindCounts = useMemo(() => {
    if (!data) return {} as Record<Kind, number>;
    const c = {} as Record<Kind, number>;
    KIND_ORDER.forEach((k) => (c[k] = 0));
    data.nodes.forEach((n) => (c[n.kind] = (c[n.kind] ?? 0) + 1));
    return c;
  }, [data]);

  const toggleKind = (k: Kind) => {
    setKindFilter((prev) => {
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
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600 dark:text-slate-300">章節：</span>
          <select
            value={chapter}
            onChange={(e) => setChapter(Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm"
          >
            {Object.entries(CHAPTER_TITLES).map(([num, title]) => (
              <option key={num} value={num}>
                Ch{String(num).padStart(2, "0")} · {title}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_ORDER.map((k) => {
            const s = KIND_STYLE[k];
            const active = kindFilter.has(k);
            return (
              <button
                key={k}
                onClick={() => toggleKind(k)}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-all"
                style={{
                  background: active ? (theme === "dark" ? s.bgDark : s.bg) : "transparent",
                  borderColor: active ? s.border : "#cbd5e1",
                  color: active ? (theme === "dark" ? "#e2e8f0" : s.text) : "#94a3b8",
                  opacity: active ? 1 : 0.5,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
                {s.label} {kindCounts[k] ?? 0}
              </button>
            );
          })}
        </div>

        {data && (
          <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
            {data.nodes.length} 節點 · {data.edges.length} 邊
          </span>
        )}
      </div>

      {/* Graph + side panel */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 min-h-0">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden relative min-h-[500px]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm z-10 bg-white/70 dark:bg-slate-900/70">
              載入中…
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
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color={theme === "dark" ? "#1e293b" : "#e2e8f0"} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => KIND_STYLE[(n.data as ConceptNodeData).kind]?.dot ?? "#94a3b8"}
              style={{ background: theme === "dark" ? "#0f172a" : "#f8fafc" }}
            />
          </ReactFlow>
        </div>

        <aside className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 overflow-auto min-h-[500px] lg:max-h-none max-h-[400px]">
          {!selectedNode ? (
            <div className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed">
              點擊任一節點查看詳情、先備關係與公式。
              <div className="mt-3 text-xs">
                <p className="font-medium mb-1 text-slate-500 dark:text-slate-400">操作：</p>
                <ul className="space-y-0.5 list-disc pl-4">
                  <li>滑鼠滾輪縮放、拖曳平移</li>
                  <li>拖動節點可重新排列</li>
                  <li>類型標籤可過濾顯示</li>
                </ul>
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
                    background: theme === "dark" ? KIND_STYLE[selectedNode.kind].bgDark : KIND_STYLE[selectedNode.kind].bg,
                    color: theme === "dark" ? "#e2e8f0" : KIND_STYLE[selectedNode.kind].text,
                  }}
                >
                  {KIND_STYLE[selectedNode.kind].label}
                </span>
                <span className="text-slate-400 dark:text-slate-500">
                  p.{selectedNode.pages.join(", ")}
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
                    {selectedPrereqs.map(({ node, reason }) => (
                      <button
                        key={node.id}
                        onClick={() => setSelectedId(node.id)}
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 text-xs">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: KIND_STYLE[node.kind].dot }}
                          />
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {node.label}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 pl-3 leading-snug">
                          {reason}
                        </div>
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
                    {selectedNexts.map(({ node, reason }) => (
                      <button
                        key={node.id}
                        onClick={() => setSelectedId(node.id)}
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 text-xs">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: KIND_STYLE[node.kind].dot }}
                          />
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {node.label}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 pl-3 leading-snug">
                          {reason}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {onNavigate && (
                <button
                  onClick={() => onNavigate("teaching", chapter)}
                  className="w-full mt-2 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  前往 Ch{String(chapter).padStart(2, "0")} 教學
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
