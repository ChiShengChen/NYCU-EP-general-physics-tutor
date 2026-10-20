"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { useTheme } from "./theme-provider";
import { CATEGORY_COLORS, CATEGORY_ORDER } from "./knowledge-graph";
import {
  STATIC_CHAPTER_GRAPH,
  EMPTY_GRAPH_OVERRIDE,
  GRAPH_TITLE_MAX,
  applyGraphOverride,
  normalizeGraphOverride,
  isEmptyGraphOverride,
  parseGraphOverride,
  edgeKey,
  type ChapterCategory,
  type ChapterEdge,
  type ChapterNode,
  type GraphNodeOverride,
  type GraphOverride,
} from "@/lib/concept-graph";

/**
 * 「🕸️ 圖譜」 — admin tab body for reviewing the chapter prerequisite graph.
 *
 * The static graph in `lib/concept-graph.ts` stays the default; what the
 * teacher edits here is a diff (`GraphOverride`) stored in
 * `concept_graph_overrides` (migration 024) and merged by every consumer.
 * Edits are kept locally and validated with `applyGraphOverride` on every
 * change (so a cycle is refused the moment the edge is drawn), then saved
 * with one PUT to /api/admin/graph, which appends a history entry.
 *
 * Canvas: drag from a node's right handle to another node's left handle to
 * add a prerequisite edge (direction = prerequisite → dependent); click an
 * edge to remove it; click a node to edit its title / group / visibility.
 */

/* ─── Types ─── */

interface HistoryEntry {
  id: number;
  data: unknown;
  updatedByEmail: string | null;
  createdAt: string;
}

interface AdminGraphData {
  override: GraphOverride;
  updatedBy: string | null;
  updatedAt: string | null;
  history: HistoryEntry[];
}

type ChapterFlowData = {
  label: string;
  chapter: number;
  category: ChapterCategory;
  hidden: boolean;
  edited: boolean;
  selected: boolean;
};
type ChapterFlowNode = Node<ChapterFlowData, "chapter">;

type EdgeChangeKind = "add" | "unadd" | "remove" | "unremove";

/* ─── Constants ─── */

const STATIC = STATIC_CHAPTER_GRAPH;
const NODE_W = 150;
const NODE_H = 46;
const API = "/api/admin/graph";

const STATIC_NODE = new Map(STATIC.nodes.map((n) => [n.id, n] as const));

const EDGE_CHANGE_LABEL: Record<EdgeChangeKind, string> = {
  add: "新增先修邊",
  unadd: "取消新增的邊",
  remove: "移除先修邊",
  unremove: "恢復移除的邊",
};

/* ─── Helpers ─── */

function chapterTag(n: number): string {
  return `Ch${String(n).padStart(2, "0")}`;
}

function overrideJson(o: GraphOverride): string {
  return JSON.stringify(normalizeGraphOverride(o, STATIC));
}

function summarizeOverride(o: GraphOverride): string {
  if (isEmptyGraphOverride(o)) return "與預設相同";
  const parts: string[] = [];
  const nodeCount = Object.keys(o.nodes).length;
  if (nodeCount) parts.push(`${nodeCount} 個節點編輯`);
  if (o.edges.added.length) parts.push(`+${o.edges.added.length} 邊`);
  if (o.edges.removed.length) parts.push(`−${o.edges.removed.length} 邊`);
  return parts.join(" · ");
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { hour12: false });
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** dagre LR layout over the given edges; positions are top-left corners (xyflow convention). */
function layoutPositions(nodes: ChapterNode[], edges: ChapterEdge[]): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 18, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.from, e.to));
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n) => {
    const p = g.node(n.id);
    out[n.id] = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  });
  return out;
}

/* ─── Custom node (palette shared with knowledge-graph.tsx) ─── */

function ChapterFlowNodeView({ data }: NodeProps<ChapterFlowNode>) {
  const c = CATEGORY_COLORS[data.category];
  return (
    <div
      className={`rounded-xl border px-3 py-1.5 text-center transition-all shadow-sm ${c.bg} ${c.border} ${
        data.selected ? "ring-2 ring-indigo-400" : ""
      } ${data.hidden ? "opacity-40 border-dashed" : ""}`}
      style={{ width: NODE_W, height: NODE_H }}
      title={data.hidden ? "已隱藏（學生端不顯示）" : undefined}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-slate-400 dark:!bg-slate-500" />
      <div className={`text-[11px] font-semibold leading-tight truncate ${c.text}`}>
        {data.label}
        {data.edited && <span className="ml-1 text-amber-500" title="已編輯">●</span>}
      </div>
      <div className="text-[9px] text-slate-400 dark:text-slate-500">
        {chapterTag(data.chapter)}
        {data.hidden && " · 隱藏"}
      </div>
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-indigo-400" />
    </div>
  );
}

const nodeTypes = { chapter: ChapterFlowNodeView };

/* ─── Tab body ─── */

export function AdminGraphEditor() {
  const { data, error, isLoading, mutate } = useSWR<AdminGraphData>(API);

  if (error) {
    const status = (error as { status?: number })?.status;
    if (status === 403) return <Forbidden />;
    return <Centered>讀取失敗：{String(error)}</Centered>;
  }
  if (isLoading || !data) return <Centered>載入圖譜設定中…</Centered>;

  // Remount the editor whenever the saved override changes (after our own
  // save / revert) so the draft resets to the server copy without an
  // effect that mirrors props into state.
  const savedJson = overrideJson(data.override);
  return (
    <GraphEditor
      key={savedJson}
      saved={normalizeGraphOverride(data.override, STATIC)}
      updatedBy={data.updatedBy}
      updatedAt={data.updatedAt}
      history={data.history}
      onSaved={async () => { await mutate(); }}
    />
  );
}

/* ─── Editor ─── */

function GraphEditor({
  saved,
  updatedBy,
  updatedAt,
  history,
  onSaved,
}: {
  saved: GraphOverride;
  updatedBy: string | null;
  updatedAt: string | null;
  history: HistoryEntry[];
  onSaved: () => Promise<void>;
}) {
  const { effective: theme } = useTheme();
  const [draft, setDraft] = useState<GraphOverride>(saved);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [positions, setPositions] = useState(() => layoutPositions(STATIC.nodes, STATIC.edges));

  const merged = useMemo(() => applyGraphOverride(STATIC, draft), [draft]);
  // The draft is only ever committed when valid, so this fallback is
  // reached only if the *saved* row no longer validates (static graph
  // changed underneath it); the banner below tells the admin.
  const graph = merged.ok ? merged.graph : STATIC;
  const savedInvalid = !merged.ok ? merged.error : null;

  const dirty = overrideJson(draft) !== overrideJson(saved);

  /** Validate + normalize + commit; returns false (and shows why) when the result is invalid. */
  const tryCommit = useCallback((next: GraphOverride): boolean => {
    const norm = normalizeGraphOverride(next, STATIC);
    const res = applyGraphOverride(STATIC, norm);
    if (!res.ok) {
      setInlineError(res.error);
      return false;
    }
    setInlineError(null);
    setDraft(norm);
    return true;
  }, []);

  const addEdge = useCallback((from: string, to: string) => {
    const k = edgeKey({ from, to });
    return tryCommit({
      ...draft,
      edges: {
        added: [...draft.edges.added, { from, to }],
        removed: draft.edges.removed.filter((e) => edgeKey(e) !== k),
      },
    });
  }, [draft, tryCommit]);

  const removeEdge = useCallback((from: string, to: string) => {
    const k = edgeKey({ from, to });
    return tryCommit({
      ...draft,
      edges: {
        added: draft.edges.added.filter((e) => edgeKey(e) !== k),
        removed: [...draft.edges.removed, { from, to }],
      },
    });
  }, [draft, tryCommit]);

  const updateNode = useCallback((id: string, patch: GraphNodeOverride) => {
    return tryCommit({ ...draft, nodes: { ...draft.nodes, [id]: { ...draft.nodes[id], ...patch } } });
  }, [draft, tryCommit]);

  const setNodeOverride = useCallback((id: string, value: GraphNodeOverride | undefined) => {
    const nodes = { ...draft.nodes };
    if (value) nodes[id] = value;
    else delete nodes[id];
    return tryCommit({ ...draft, nodes });
  }, [draft, tryCommit]);

  /* ── Canvas data ── */

  // Every static node is drawn (hidden ones dimmed so they can be un-hidden);
  // edges come from the merged graph, which already drops hidden nodes' edges.
  const canvasNodes = useMemo(() => {
    const mergedById = new Map(graph.nodes.map((n) => [n.id, n] as const));
    return STATIC.nodes.map((n) => {
      const m = mergedById.get(n.id);
      const o = draft.nodes[n.id];
      return {
        id: n.id,
        label: m?.label ?? o?.title ?? n.label,
        chapter: m?.chapter ?? o?.chapter ?? n.chapter,
        category: m?.category ?? o?.group ?? n.category,
        hidden: !m,
        edited: !!o,
      };
    });
  }, [graph, draft]);

  const labelOf = useCallback((id: string) => {
    const n = canvasNodes.find((x) => x.id === id);
    return n ? `${chapterTag(n.chapter)} ${n.label}` : id;
  }, [canvasNodes]);

  const flowNodes = useMemo<ChapterFlowNode[]>(
    () =>
      canvasNodes.map((n) => ({
        id: n.id,
        type: "chapter",
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: { ...n, selected: n.id === selectedId },
      })),
    [canvasNodes, positions, selectedId],
  );

  const addedKeys = useMemo(() => new Set(draft.edges.added.map(edgeKey)), [draft]);
  const flowEdges = useMemo<Edge[]>(() => {
    const active = selectedId;
    return graph.edges.map((e) => {
      const k = edgeKey(e);
      const isAdded = addedKeys.has(k);
      const touches = active !== null && (e.from === active || e.to === active);
      const color = isAdded ? "#10b981" : touches ? "#6366f1" : theme === "dark" ? "#475569" : "#94a3b8";
      return {
        id: k,
        source: e.from,
        target: e.to,
        animated: isAdded,
        style: { stroke: color, strokeWidth: touches || isAdded ? 2.5 : 1.5, cursor: "pointer" },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        label: isAdded ? "新增" : undefined,
        labelStyle: { fill: "#059669", fontSize: 10 },
        labelBgStyle: { fill: theme === "dark" ? "#0f172a" : "#ffffff" },
      };
    });
  }, [graph.edges, addedKeys, selectedId, theme]);

  const onNodesChange = useCallback<OnNodesChange<ChapterFlowNode>>((changes) => {
    setPositions((prev) => {
      let next = prev;
      for (const c of changes) {
        if (c.type === "position" && c.position) next = { ...next, [c.id]: c.position };
      }
      return next;
    });
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) addEdge(c.source, c.target);
  }, [addEdge]);

  const onEdgeClick = useCallback((_: unknown, e: Edge) => {
    removeEdge(e.source, e.target);
  }, [removeEdge]);

  const relayout = () => setPositions(layoutPositions(STATIC.nodes, graph.edges));

  /* ── Server actions ── */

  const request = async (init: RequestInit) => {
    setBusy(true);
    setInlineError(null);
    try {
      const res = await fetch(API, { headers: { "Content-Type": "application/json" }, ...init });
      if (!res.ok) {
        setInlineError(await readError(res));
        return false;
      }
      await onSaved();
      return true;
    } catch (e) {
      setInlineError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = () => request({ method: "PUT", body: JSON.stringify({ override: draft }) });

  const resetToDefault = () => {
    if (!window.confirm("確定清除所有覆寫、回到程式內建的預設圖譜？（可從歷史紀錄回復）")) return;
    return request({ method: "PUT", body: JSON.stringify({ override: EMPTY_GRAPH_OVERRIDE }) });
  };

  const revertTo = (h: HistoryEntry) => {
    if (dirty && !window.confirm("目前有未儲存的變更，回復到歷史版本會捨棄它們。繼續？")) return;
    return request({ method: "POST", body: JSON.stringify({ action: "revert", historyId: h.id }) });
  };

  const discard = () => {
    setDraft(saved);
    setInlineError(null);
  };

  /* ── Unsaved diff (draft vs saved) ── */

  const edgeChanges = useMemo(() => {
    const savedAdded = new Set(saved.edges.added.map(edgeKey));
    const savedRemoved = new Set(saved.edges.removed.map(edgeKey));
    const draftAdded = new Set(draft.edges.added.map(edgeKey));
    const draftRemoved = new Set(draft.edges.removed.map(edgeKey));
    const out: { kind: EdgeChangeKind; edge: ChapterEdge }[] = [];
    draft.edges.added.forEach((e) => { if (!savedAdded.has(edgeKey(e))) out.push({ kind: "add", edge: e }); });
    saved.edges.added.forEach((e) => { if (!draftAdded.has(edgeKey(e))) out.push({ kind: "unadd", edge: e }); });
    draft.edges.removed.forEach((e) => { if (!savedRemoved.has(edgeKey(e))) out.push({ kind: "remove", edge: e }); });
    saved.edges.removed.forEach((e) => { if (!draftRemoved.has(edgeKey(e))) out.push({ kind: "unremove", edge: e }); });
    return out;
  }, [draft, saved]);

  const nodeChanges = useMemo(() => {
    const ids = new Set([...Object.keys(saved.nodes), ...Object.keys(draft.nodes)]);
    return Array.from(ids)
      .filter((id) => JSON.stringify(saved.nodes[id] ?? null) !== JSON.stringify(draft.nodes[id] ?? null))
      .sort()
      .map((id) => ({ id, before: saved.nodes[id], after: draft.nodes[id] }));
  }, [draft, saved]);

  const revertEdgeChange = (c: { kind: EdgeChangeKind; edge: ChapterEdge }) => {
    const k = edgeKey(c.edge);
    const added = draft.edges.added.filter((e) => edgeKey(e) !== k);
    const removed = draft.edges.removed.filter((e) => edgeKey(e) !== k);
    if (c.kind === "unadd") added.push(c.edge);
    if (c.kind === "unremove") removed.push(c.edge);
    tryCommit({ ...draft, edges: { added, removed } });
  };

  const describeNodeChange = (o: GraphNodeOverride | undefined): string => {
    if (!o) return "回到預設";
    const parts: string[] = [];
    if (o.title !== undefined) parts.push(`標題「${o.title}」`);
    if (o.group !== undefined) parts.push(`分類 ${CATEGORY_COLORS[o.group]?.label ?? o.group}`);
    if (o.chapter !== undefined) parts.push(`章節 ${chapterTag(o.chapter)}`);
    if (o.hidden) parts.push("隱藏");
    return parts.join("、") || "回到預設";
  };

  const selected = selectedId ? canvasNodes.find((n) => n.id === selectedId) ?? null : null;
  const currentHistoryJson = overrideJson(saved);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Status line */}
      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-slate-400">
        <span>
          目前覆寫：<strong className="text-slate-700 dark:text-slate-200">{summarizeOverride(saved)}</strong>
        </span>
        {updatedAt && (
          <span>· 最後儲存 {formatTime(updatedAt)}{updatedBy ? `（${updatedBy}）` : ""}</span>
        )}
        <span className="ml-auto">
          拖曳右側把手到另一節點的左側把手 = 加先修邊 · 點邊 = 移除 · 點節點 = 編輯
        </span>
      </div>

      {savedInvalid && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
          已儲存的覆寫與目前的預設圖譜不相容（{savedInvalid}），學生端暫時顯示預設圖譜。請修正後重新儲存，或「還原預設」。
        </div>
      )}

      {inlineError && (
        <div className="rounded-xl border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-200 flex items-start gap-2">
          <span className="shrink-0">⚠️</span>
          <span className="flex-1">{inlineError}</span>
          <button onClick={() => setInlineError(null)} className="text-rose-400 hover:text-rose-600" aria-label="關閉">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* Canvas */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden relative min-h-[560px] h-[70vh]">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            onNodeClick={(_, n) => setSelectedId((cur) => (cur === n.id ? null : n.id))}
            onPaneClick={() => setSelectedId(null)}
            deleteKeyCode={null}
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
              nodeColor={(n) => CATEGORY_COLORS[(n.data as ChapterFlowData).category]?.svgStrokeSelected ?? "#94a3b8"}
              style={{ background: theme === "dark" ? "#0f172a" : "#f8fafc" }}
            />
          </ReactFlow>
          <div className="absolute top-2 left-2 flex items-center gap-2 text-[11px]">
            <button
              onClick={relayout}
              className="px-2 py-1 rounded-lg bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              重新排版
            </button>
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700">
              {CATEGORY_ORDER.map((cat) => (
                <span key={cat} className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                  <span className={`w-2.5 h-2.5 rounded-full border ${CATEGORY_COLORS[cat].bg} ${CATEGORY_COLORS[cat].border}`} />
                  {CATEGORY_COLORS[cat].label}
                </span>
              ))}
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="w-4 h-0.5 bg-emerald-500" />新增邊
              </span>
            </div>
          </div>
        </div>

        {/* Side column */}
        <div className="space-y-4">
          {/* Node panel */}
          <Section title={selected ? `${chapterTag(selected.chapter)} · ${selected.label}` : "節點"}>
            {!selected ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">點擊畫布上的節點來編輯標題、分類或隱藏它。</p>
            ) : (
              <NodePanel
                key={selected.id}
                node={selected}
                override={draft.nodes[selected.id]}
                prereqs={graph.edges.filter((e) => e.to === selected.id).map((e) => e.from)}
                nexts={graph.edges.filter((e) => e.from === selected.id).map((e) => e.to)}
                candidates={canvasNodes.filter((n) => n.id !== selected.id && !n.hidden)}
                labelOf={labelOf}
                onUpdate={(patch) => updateNode(selected.id, patch)}
                onReset={() => setNodeOverride(selected.id, undefined)}
                onAddPrereq={(from) => addEdge(from, selected.id)}
                onRemoveEdge={removeEdge}
                onSelect={setSelectedId}
                onClose={() => setSelectedId(null)}
              />
            )}
          </Section>

          {/* Unsaved diff */}
          <Section title={`未儲存變更${dirty ? `（${edgeChanges.length + nodeChanges.length}）` : ""}`}>
            {!dirty ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">沒有未儲存的變更。</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {edgeChanges.map((c) => (
                  <li key={`${c.kind}:${edgeKey(c.edge)}`} className="flex items-start gap-2">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded ${c.kind === "add" || c.kind === "unremove" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" : "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300"}`}>
                      {EDGE_CHANGE_LABEL[c.kind]}
                    </span>
                    <span className="flex-1 text-slate-700 dark:text-slate-200">
                      {labelOf(c.edge.from)} → {labelOf(c.edge.to)}
                    </span>
                    <button onClick={() => revertEdgeChange(c)} className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300" title="撤銷這項變更">↩</button>
                  </li>
                ))}
                {nodeChanges.map((c) => (
                  <li key={`node:${c.id}`} className="flex items-start gap-2">
                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300">節點</span>
                    <span className="flex-1 text-slate-700 dark:text-slate-200">
                      {labelOf(c.id)}：{describeNodeChange(c.after)}
                      {c.before && <span className="text-slate-400 dark:text-slate-500">（原 {describeNodeChange(c.before)}）</span>}
                    </span>
                    <button onClick={() => setNodeOverride(c.id, c.before)} className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300" title="撤銷這項變更">↩</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 flex-wrap mt-3 text-xs">
              <button
                onClick={save}
                disabled={!dirty || busy}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "儲存中…" : "儲存"}
              </button>
              <button
                onClick={discard}
                disabled={!dirty || busy}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                放棄變更
              </button>
              <button
                onClick={resetToDefault}
                disabled={busy || (isEmptyGraphOverride(saved) && !dirty)}
                className="ml-auto px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
                title="清除所有覆寫，回到程式內建的圖譜"
              >
                還原預設
              </button>
            </div>
          </Section>

          {/* History */}
          <Section title="歷史紀錄">
            {history.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">還沒有儲存過任何版本。</p>
            ) : (
              <ul className="space-y-1.5 text-xs max-h-72 overflow-auto">
                {history.map((h) => {
                  const parsed = parseGraphOverride(h.data);
                  const isCurrent = parsed.ok && overrideJson(parsed.override) === currentHistoryJson;
                  return (
                    <li key={h.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 bg-slate-50 dark:bg-slate-800/50">
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-700 dark:text-slate-200 truncate">
                          {formatTime(h.createdAt)}
                          {isCurrent && <span className="ml-1 px-1 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">目前版本</span>}
                        </div>
                        <div className="text-slate-400 dark:text-slate-500 truncate">
                          {parsed.ok ? summarizeOverride(normalizeGraphOverride(parsed.override, STATIC)) : "（無法解析）"}
                          {h.updatedByEmail ? ` · ${h.updatedByEmail}` : ""}
                        </div>
                      </div>
                      {!isCurrent && parsed.ok && (
                        <button
                          onClick={() => revertTo(h)}
                          disabled={busy}
                          className="shrink-0 text-indigo-600 dark:text-indigo-300 hover:underline disabled:opacity-40"
                        >
                          回復到此版本
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ─── Node side panel ─── */

function NodePanel({
  node,
  override,
  prereqs,
  nexts,
  candidates,
  labelOf,
  onUpdate,
  onReset,
  onAddPrereq,
  onRemoveEdge,
  onSelect,
  onClose,
}: {
  node: { id: string; label: string; chapter: number; category: ChapterCategory; hidden: boolean };
  override: GraphNodeOverride | undefined;
  prereqs: string[];
  nexts: string[];
  candidates: { id: string; label: string; chapter: number }[];
  labelOf: (id: string) => string;
  onUpdate: (patch: GraphNodeOverride) => boolean;
  onReset: () => boolean;
  onAddPrereq: (from: string) => boolean;
  onRemoveEdge: (from: string, to: string) => boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const base = STATIC_NODE.get(node.id)!;
  const [title, setTitle] = useState(node.label);
  const [newPrereq, setNewPrereq] = useState("");

  const commitTitle = () => {
    const t = title.trim();
    if (!t) { setTitle(node.label); return; }
    if (t !== node.label) onUpdate({ title: t });
  };

  const inputCls =
    "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400";

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
        <span>預設：{chapterTag(base.chapter)} {base.label} · {CATEGORY_COLORS[base.category].label}</span>
        <button onClick={onClose} className="hover:text-slate-600 dark:hover:text-slate-200" aria-label="關閉">✕</button>
      </div>

      <label className="block">
        <span className="text-xs text-slate-500 dark:text-slate-400">標題（最多 {GRAPH_TITLE_MAX} 字）</span>
        <input
          value={title}
          maxLength={GRAPH_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className={inputCls}
        />
      </label>

      <label className="block">
        <span className="text-xs text-slate-500 dark:text-slate-400">分類</span>
        <select
          value={node.category}
          onChange={(e) => onUpdate({ group: e.target.value as ChapterCategory })}
          className={inputCls}
        >
          {CATEGORY_ORDER.map((cat) => (
            <option key={cat} value={cat}>{CATEGORY_COLORS[cat].label}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={node.hidden}
          onChange={(e) => onUpdate({ hidden: e.target.checked })}
          className="rounded"
        />
        隱藏此節點（學生端不顯示，連帶的先修邊也會略過）
      </label>

      {override && (
        <button onClick={onReset} className="text-xs text-indigo-600 dark:text-indigo-300 hover:underline">
          還原此節點的編輯
        </button>
      )}

      {!node.hidden && (
        <>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">先修（{prereqs.length}）</div>
            {prereqs.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">無（起始概念）</p>}
            <ul className="space-y-1">
              {prereqs.map((id) => (
                <EdgeRow key={id} label={labelOf(id)} onJump={() => onSelect(id)} onRemove={() => onRemoveEdge(id, node.id)} />
              ))}
            </ul>
            <div className="flex items-center gap-1.5 mt-1.5">
              <select value={newPrereq} onChange={(e) => setNewPrereq(e.target.value)} className={`${inputCls} text-xs`}>
                <option value="">— 新增先修章節 —</option>
                {candidates
                  .filter((c) => !prereqs.includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>{chapterTag(c.chapter)} {c.label}</option>
                  ))}
              </select>
              <button
                onClick={() => { if (newPrereq && onAddPrereq(newPrereq)) setNewPrereq(""); }}
                disabled={!newPrereq}
                className="shrink-0 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-700 disabled:opacity-40"
              >
                加入
              </button>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">後續（{nexts.length}）</div>
            {nexts.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">無（終端概念）</p>}
            <ul className="space-y-1">
              {nexts.map((id) => (
                <EdgeRow key={id} label={labelOf(id)} onJump={() => onSelect(id)} onRemove={() => onRemoveEdge(node.id, id)} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function EdgeRow({ label, onJump, onRemove }: { label: string; onJump: () => void; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <button onClick={onJump} className="flex-1 text-left px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 truncate">
        {label}
      </button>
      <button onClick={onRemove} className="shrink-0 text-slate-400 hover:text-rose-600 dark:hover:text-rose-300" title="移除這條先修邊" aria-label="移除">✕</button>
    </li>
  );
}

/* ─── Shared bits (mirrors admin-question-bank.tsx) ─── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto py-12 text-center text-sm text-slate-500 dark:text-slate-400">{children}</div>
  );
}

function Forbidden() {
  return (
    <div className="max-w-3xl mx-auto py-12 text-center space-y-3">
      <p className="text-4xl">🛡️</p>
      <p className="text-slate-700 dark:text-slate-200 font-medium">沒有管理員權限</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        這個頁面只開放給 ADMIN_EMAILS 環境變數中列名的帳號。請改用既有的學生功能。
      </p>
    </div>
  );
}
