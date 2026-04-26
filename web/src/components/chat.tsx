"use client";

import { useChat } from "@ai-sdk/react";
import { type UIMessage, DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, type FormEvent } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

const SUGGESTED_QUESTIONS = [
  "解釋牛頓第二定律的向量形式",
  "Gauss's Law 怎麼用在球對稱電荷？",
  "簡諧運動和等速圓周運動有什麼關係？",
];

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function Chat({ onBack }: { onBack?: () => void } = {}) {
  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    const stored = localStorage.getItem("physics_tutor_student_id");
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem("physics_tutor_student_id", id);
    return id;
  });

  const [transport] = useState(
    () => new DefaultChatTransport({ body: () => ({ studentId }) }),
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isBusy = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    setInput("");
    sendMessage({ text });
  };

  const handleChipClick = (question: string) => {
    sendMessage({ text: question });
  };

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
            aria-label="返回"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <span className="text-xl">🔬</span>
        <h1 className="text-lg font-semibold text-slate-800">普通物理 AI 助教</h1>
        <span className="text-xs text-slate-400 ml-auto">NYCU 電物系 · 楊本立老師</span>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
            <div>
              <p className="text-2xl mb-2">👋</p>
              <p className="text-lg text-slate-600">嗨！我是普通物理的 AI 助教</p>
              <p className="text-sm text-slate-400">有什麼問題嗎？</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleChipClick(q)}
                  className="px-3 py-1.5 text-sm rounded-full border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const text = getTextContent(m);
            if (!text) return null;
            return (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-white border border-slate-200 shadow-sm rounded-bl-sm"
                  }`}
                >
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap">{text}</p>
                  ) : (
                    <MarkdownRenderer content={text} />
                  )}
                </div>
              </div>
            );
          })
        )}

        {isBusy && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="輸入問題..."
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
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
