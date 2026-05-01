"use client";

import { useState, useEffect } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

/* ─── Types ─── */

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface Session {
  id: number;
  startTime: string;
  endTime: string;
  messages: ChatMessage[];
  preview: string;
}

/* ─── Component ─── */

interface ChatHistoryProps {
  onBack: () => void;
  /** Resume a past session in the chat ("自由問答") view with its messages
   *  pre-loaded so the next user turn includes them in LLM context.
   *  Optional pendingMessage is auto-sent once the chat mounts. */
  onResume?: (sessionId: number, messages: ChatMessage[], pendingMessage?: string) => void;
}

export function ChatHistory({ onBack, onResume }: ChatHistoryProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("physics_tutor_student_id") ?? "";
  });

  useEffect(() => {
    if (!studentId) {
      setLoading(false);
      return;
    }

    fetch(`/api/history?studentId=${studentId}`)
      .then((res) => res.json())
      .then((d) => {
        setSessions(d.sessions ?? []);
        setTotalMessages(d.totalMessages ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [studentId]);

  // Session detail view
  if (selectedSession) {
    return (
      <SessionDetail
        session={selectedSession}
        onBack={() => setSelectedSession(null)}
        onBackToHome={onBack}
        onResume={
          onResume
            ? (pendingMessage) => onResume(selectedSession.id, selectedSession.messages, pendingMessage)
            : undefined
        }
      />
    );
  }

  // Session list view
  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
          aria-label="返回"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">🕒</span>
        <h1 className="text-lg font-semibold text-slate-800">對話歷史</h1>
        {totalMessages > 0 && (
          <span className="text-xs text-slate-400 ml-1">
            共 {totalMessages} 則訊息，{sessions.length} 個對話
          </span>
        )}
        <span className="text-xs text-slate-400 ml-auto">NYCU 電物系</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-400">載入中...</div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <p className="text-4xl">📭</p>
            <p className="text-slate-500">還沒有對話紀錄</p>
            <button
              onClick={onBack}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              返回首頁
            </button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-3">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setSelectedSession(session)}
                className="w-full text-left bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">
                    {formatDate(session.startTime)}
                  </span>
                  <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                    {session.messages.length} 則訊息
                  </span>
                </div>
                <p className="text-sm text-slate-700 line-clamp-2">{session.preview}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                  <span>
                    {formatTime(session.startTime)} - {formatTime(session.endTime)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Session Detail ─── */

function SessionDetail({
  session,
  onBack,
  onBackToHome,
  onResume,
}: {
  session: Session;
  onBack: () => void;
  onBackToHome: () => void;
  onResume?: (pendingMessage?: string) => void;
}) {
  const [followUp, setFollowUp] = useState("");
  const handleFollowUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = followUp.trim();
    if (!text) return;
    onResume?.(text);
  };
  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
          aria-label="返回列表"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">💬</span>
        <h1 className="text-lg font-semibold text-slate-800">
          {formatDate(session.startTime)}
        </h1>
        <span className="text-xs text-slate-400">
          {session.messages.length} 則訊息
        </span>
        {onResume && (
          <button
            onClick={() => onResume()}
            className="ml-auto px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            繼續對話
          </button>
        )}
        <button
          onClick={onBackToHome}
          className={`text-xs text-slate-500 hover:text-indigo-600 transition-colors ${onResume ? "" : "ml-auto"}`}
        >
          返回首頁
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-w-3xl mx-auto w-full">
        {session.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-white border border-slate-200 shadow-sm rounded-bl-sm"
              }`}
            >
              {msg.role === "user" ? (
                <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
              ) : (
                <MarkdownRenderer content={msg.content} />
              )}
              <p
                className={`text-[10px] mt-1 ${
                  msg.role === "user" ? "text-indigo-200" : "text-slate-300"
                }`}
              >
                {formatTime(msg.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {onResume && (
        <form
          onSubmit={handleFollowUpSubmit}
          className="shrink-0 border-t border-slate-200 bg-white px-4 py-3"
        >
          <div className="max-w-3xl mx-auto flex gap-2">
            <input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="繼續這段對話...（按下送出後會跳到自由問答介面）"
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={!followUp.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              送出
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ─── Helpers ─── */

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}
