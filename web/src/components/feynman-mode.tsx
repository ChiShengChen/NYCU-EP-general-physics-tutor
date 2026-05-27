"use client";

/**
 * Feynman mode (🎓 教 AI) — student picks a concept, then the AI role-plays
 * a confused junior who is being tutored by the student. After 4–6 exchanges
 * the AI switches to "evaluator mode" and gives structured feedback.
 *
 * Reuses /api/chat with body { mode: "feynman", concept } so we get all the
 * existing RAG + persistence + multimodal infrastructure for free.
 */

import { useChat } from "@ai-sdk/react";
import { type UIMessage, DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

interface FeynmanModeProps {
  onBack: () => void;
}

/* Curated starter concepts — covers all four big areas. Students can also
 * type a free-form concept. */
const SUGGESTED_CONCEPTS: { label: string; group: string }[] = [
  // 力學
  { label: "牛頓第二定律", group: "力學" },
  { label: "動量守恆", group: "力學" },
  { label: "能量守恆", group: "力學" },
  { label: "角動量守恆", group: "力學" },
  { label: "簡諧運動", group: "力學" },
  { label: "圓周運動的向心力", group: "力學" },
  // 流體 / 波動
  { label: "白努利方程式", group: "流體 / 波動" },
  { label: "波的疊加原理", group: "流體 / 波動" },
  { label: "都卜勒效應", group: "流體 / 波動" },
  // 熱學
  { label: "熱力學第一定律", group: "熱學" },
  { label: "熵與第二定律", group: "熱學" },
  { label: "理想氣體狀態方程", group: "熱學" },
  // 電磁
  { label: "高斯定律", group: "電磁" },
  { label: "電位與電場的關係", group: "電磁" },
  { label: "法拉第電磁感應", group: "電磁" },
  { label: "安培定律", group: "電磁" },
  { label: "Maxwell 方程式", group: "電磁" },
];

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function FeynmanMode({ onBack }: FeynmanModeProps) {
  const [concept, setConcept] = useState<string | null>(null);
  const [draftConcept, setDraftConcept] = useState("");

  if (!concept) {
    return (
      <ConceptPicker
        onBack={onBack}
        draft={draftConcept}
        setDraft={setDraftConcept}
        onPick={(c) => setConcept(c)}
      />
    );
  }

  return (
    <FeynmanChat
      concept={concept}
      onBack={onBack}
      onChangeConcept={() => setConcept(null)}
    />
  );
}

/* ─── Concept Picker ─── */

function ConceptPicker({
  onBack,
  draft,
  setDraft,
  onPick,
}: {
  onBack: () => void;
  draft: string;
  setDraft: (s: string) => void;
  onPick: (concept: string) => void;
}) {
  const groups = Array.from(new Set(SUGGESTED_CONCEPTS.map((c) => c.group)));
  const trimmed = draft.trim();

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
        <span className="text-xl">🎓</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">教 AI — 費曼學習法</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">用「教給別人」的方式學最深</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
            <p className="font-medium mb-1">怎麼玩？</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>選一個你想加深理解的概念</li>
              <li>AI 會扮演<strong>聽不太懂的學弟/妹</strong>，請你用自己的話教他</li>
              <li>他會針對你講得模糊、跳步、可能有迷思的地方追問</li>
              <li>大約 4–6 個來回後，AI 會切換成「評估模式」整理：
                <ul className="list-disc pl-5 mt-0.5">
                  <li>✅ 你講清楚的</li>
                  <li>🟡 還模糊的</li>
                  <li>❌ 沒提到但關鍵的</li>
                </ul>
              </li>
            </ul>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (trimmed) onPick(trimmed);
            }}
            className="space-y-2"
          >
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">輸入想練的概念（自由輸入）</label>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="例：動量守恆、Faraday's law、Bernoulli 方程式..."
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={!trimmed}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                開始
              </button>
            </div>
          </form>

          {groups.map((g) => (
            <div key={g}>
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">{g}</h3>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_CONCEPTS.filter((c) => c.group === g).map((c) => (
                  <button
                    key={c.label}
                    onClick={() => onPick(c.label)}
                    className="px-3 py-1.5 text-sm rounded-full border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:bg-indigo-950/30 transition-colors"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Role-play Chat ─── */

function FeynmanChat({
  concept,
  onBack,
  onChangeConcept,
}: {
  concept: string;
  onBack: () => void;
  onChangeConcept: () => void;
}) {
  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    const stored = localStorage.getItem("physics_tutor_student_id");
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem("physics_tutor_student_id", id);
    return id;
  });
  const [sessionId] = useState(() =>
    typeof crypto !== "undefined" ? crypto.randomUUID() : "feynman",
  );

  // Refs so the transport's body callback reads latest values without
  // rebuilding the transport (which would re-init useChat mid-session).
  /* eslint-disable react-hooks/refs */
  const conceptRef = useRef(concept);
  conceptRef.current = concept;
  const studentIdRef = useRef(studentId);
  studentIdRef.current = studentId;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  /* eslint-enable react-hooks/refs */

  /* eslint-disable react-hooks/refs */
  const [transport] = useState(
    () => new DefaultChatTransport({
      body: () => ({
        mode: "feynman",
        concept: conceptRef.current,
        studentId: studentIdRef.current,
        sessionId: sessionIdRef.current,
      }),
    }),
  );
  /* eslint-enable react-hooks/refs */

  const { messages, sendMessage, status } = useChat({
    transport,
    id: `feynman-${concept}-${sessionId}`,
  });
  const isBusy = status === "streaming" || status === "submitted";

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Kick off: send a silent "begin" message so AI emits its opener as the
  // confused junior. We hide this initiator from the rendered UI by tagging
  // with a sentinel that we filter out below.
  const hasOpenedRef = useRef(false);
  useEffect(() => {
    if (hasOpenedRef.current || isBusy || messages.length > 0) return;
    hasOpenedRef.current = true;
    const timer = setTimeout(() => {
      sendMessage({ text: "__FEYNMAN_BEGIN__" });
    }, 200);
    return () => clearTimeout(timer);
  }, [isBusy, messages.length, sendMessage]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    setInput("");
    sendMessage({ text });
  }, [input, isBusy, sendMessage]);

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto">
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
        <span className="text-xl">🎓</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100 truncate">教 AI — {concept}</h1>
        <button
          onClick={onChangeConcept}
          className="ml-auto text-xs px-2 py-0.5 rounded-md text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:text-indigo-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
        >
          換概念
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages
          .filter((m) => getTextContent(m) !== "__FEYNMAN_BEGIN__")
          .map((m) => {
            const text = getTextContent(m);
            if (!text) return null;
            return (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-slate-800 dark:text-slate-100 shadow-sm rounded-bl-sm"
                  }`}
                >
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap">{text}</p>
                  ) : (
                    <>
                      <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300 mb-1">🐣 學弟/妹</p>
                      <MarkdownRenderer content={text} />
                    </>
                  )}
                </div>
              </div>
            );
          })}

        {isBusy && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="用你自己的話教學弟/妹...（公式可用 $..$）"
            className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
            disabled={isBusy}
          />
          <button
            type="submit"
            disabled={isBusy || !input.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            送出
          </button>
        </div>
      </form>
    </div>
  );
}
