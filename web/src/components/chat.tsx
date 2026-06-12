"use client";

import { useChat } from "@ai-sdk/react";
import { type UIMessage, DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, useCallback, type FormEvent, type ChangeEvent } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { FormulaHelp } from "./formula-help";
import { AiSketch } from "./ai-sketch";
import { ThemeToggle } from "./theme-provider";
import { restoreLatexEscapes } from "@/lib/restore-latex";

const SUGGESTED_QUESTIONS = [
  "解釋牛頓第二定律的向量形式",
  "Gauss's Law 怎麼用在球對稱電荷？",
  "簡諧運動和等速圓周運動有什麼關係？",
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Extract image attachments (data URL or remote URL) from a UIMessage's parts.
 *  AI SDK v6 represents uploaded images as `file` parts with mediaType image/*. */
function getImageParts(message: UIMessage): { url: string; mediaType: string }[] {
  const out: { url: string; mediaType: string }[] = [];
  for (const p of message.parts) {
    // file parts (uploaded via sendMessage({ files }))
    if (p.type === "file" && typeof (p as { mediaType?: string }).mediaType === "string") {
      const mt = (p as { mediaType: string }).mediaType;
      if (!mt.startsWith("image/")) continue;
      const url = (p as { url?: string; data?: string }).url
        ?? (p as { url?: string; data?: string }).data
        ?? "";
      if (url) out.push({ url, mediaType: mt });
    }
  }
  return out;
}

/** Extract sketchVisualUnderstanding tool outputs from a UIMessage's parts.
 *  AI SDK v6 represents tool calls as parts of type `tool-{toolName}` once
 *  the tool's execute has resolved (state == 'output-available'). */
function getSketchParts(
  message: UIMessage,
): { title: string; svg: string; notes?: string; key: string }[] {
  const out: { title: string; svg: string; notes?: string; key: string }[] = [];
  for (const p of message.parts) {
    const part = p as { type: string; state?: string; output?: unknown; toolCallId?: string };
    if (part.type !== "tool-sketchVisualUnderstanding") continue;
    if (part.state !== "output-available") continue;
    const o = part.output as { title?: unknown; svg?: unknown; notes?: unknown } | null | undefined;
    if (!o || typeof o.svg !== "string") continue;
    out.push({
      title: typeof o.title === "string" ? o.title : "AI 對圖的理解",
      svg: o.svg,
      notes: typeof o.notes === "string" && o.notes ? o.notes : undefined,
      key: part.toolCallId ?? `${out.length}`,
    });
  }
  return out;
}

interface ChatProps {
  onBack?: () => void;
  initialMessages?: UIMessage[];
  resumeKey?: string | number;
  pendingMessage?: string;
  sessionId?: string;
}

export function Chat({ onBack, initialMessages, resumeKey, pendingMessage, sessionId }: ChatProps = {}) {
  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    const stored = localStorage.getItem("physics_tutor_student_id");
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem("physics_tutor_student_id", id);
    return id;
  });

  // Socratic mode: AI doesn't give direct answers, asks guiding questions
  // first. Preference persists in localStorage. Initial value is read
  // lazily so we don't pay a setState-in-effect roundtrip on every mount.
  const [socratic, setSocraticState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("physics_tutor_socratic") === "1";
  });
  const setSocratic = useCallback((v: boolean) => {
    setSocraticState(v);
    if (typeof window !== "undefined") {
      localStorage.setItem("physics_tutor_socratic", v ? "1" : "0");
    }
  }, []);

  // Refs so the transport's body callback always reads the latest values
  // without rebuilding the transport (which would re-init useChat and
  // wipe the in-flight stream / message history). The ref writes are
  // intentional — the alternative (useEffect → setState mirror) just
  // moves the write to a slightly later tick without the consistency
  // win, so we eslint-disable the React 19 refs rule for these.
  /* eslint-disable react-hooks/refs */
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const studentIdRef = useRef(studentId);
  studentIdRef.current = studentId;
  const socraticRef = useRef(socratic);
  socraticRef.current = socratic;
  /* eslint-enable react-hooks/refs */

  // Transport built once on mount; the body callback fires per-request
  // and reads through refs above, so toggling socratic mid-conversation
  // affects the next message without rebuilding useChat's state. The
  // body() closure is dispatched outside of render, but eslint can't
  // tell, hence the block-level disable.
  /* eslint-disable react-hooks/refs */
  const [transport] = useState(
    () => new DefaultChatTransport({
      body: () => ({
        studentId: studentIdRef.current,
        sessionId: sessionIdRef.current,
        socratic: socraticRef.current,
      }),
    }),
  );
  /* eslint-enable react-hooks/refs */

  const { messages, sendMessage, status } = useChat({
    id: `qa-${resumeKey ?? "fresh"}`,
    transport,
    messages: initialMessages,
  });
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isBusy = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-send a pending follow-up message exactly once when chat resumes.
  const sentPendingRef = useRef(false);
  useEffect(() => {
    if (!pendingMessage || sentPendingRef.current) return;
    if (isBusy) return;
    sentPendingRef.current = true;
    sendMessage({ text: pendingMessage });
  }, [pendingMessage, isBusy, sendMessage]);

  const handleFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";  // allow re-selecting the same file later
    const accepted: File[] = [];
    for (const f of picked) {
      if (!f.type.startsWith("image/")) {
        setFileError(`只能上傳圖片：${f.name}`);
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setFileError(`圖片太大（>${(MAX_IMAGE_BYTES / 1024 / 1024) | 0}MB）：${f.name}`);
        continue;
      }
      accepted.push(f);
    }
    setPendingFiles((prev) => [...prev, ...accepted].slice(0, 4));  // max 4 per message
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    const text = input.trim();
    const hasFiles = pendingFiles.length > 0;
    if (!text && !hasFiles) return;
    setInput("");
    const filesToSend = pendingFiles;
    setPendingFiles([]);
    setFileError(null);

    // useChat's sendMessage({ text, files }) wraps files into multimodal parts.
    // It expects FileList — build one from File[] via DataTransfer.
    if (hasFiles) {
      const dt = new DataTransfer();
      filesToSend.forEach((f) => dt.items.add(f));
      sendMessage({
        text: text || "請看這張圖，幫我說明這道題或這個公式。",
        files: dt.files,
      });
    } else {
      sendMessage({ text });
    }
  };

  const handleChipClick = (question: string) => {
    sendMessage({ text: question });
  };

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
            aria-label="返回"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <span className="text-xl">🔬</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">普通物理 AI 助教</h1>
        <button
          onClick={() => setSocratic(!socratic)}
          title={
            socratic
              ? "蘇格拉底模式：AI 會反問引導你思考，不直接給答案。點此關閉。"
              : "啟用蘇格拉底模式：AI 會先反問引導你自己推導，而不是直接給答案。"
          }
          className={`ml-2 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            socratic
              ? "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:bg-amber-900/40"
              : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          }`}
        >
          🦉 蘇格拉底 {socratic ? "ON" : "OFF"}
        </button>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">NYCU 電物系 · 楊本立老師</span>
        <ThemeToggle />
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
            <div>
              <p className="text-2xl mb-2">👋</p>
              <p className="text-lg text-slate-600 dark:text-slate-300">嗨！我是普通物理的 AI 助教</p>
              <p className="text-sm text-slate-400 dark:text-slate-500">有什麼問題嗎？打字或上傳公式照片皆可</p>
              {socratic && (
                <p className="mt-3 inline-block text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-full px-3 py-1">
                  🦉 蘇格拉底模式啟用中 — 我會先反問引導你思考，請放心試錯
                </p>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleChipClick(q)}
                  className="px-3 py-1.5 text-sm rounded-full border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300 bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:bg-indigo-950/30 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const text = getTextContent(m);
            const images = getImageParts(m);
            const sketches = m.role === "assistant" ? getSketchParts(m) : [];
            if (!text && images.length === 0 && sketches.length === 0) return null;
            return (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 space-y-2 ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-bl-sm"
                  }`}
                >
                  {images.length > 0 && (
                    <div className={`flex flex-wrap gap-2 ${text ? "" : "mb-0"}`}>
                      {images.map((img, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={img.url}
                          alt="附圖"
                          className="rounded-lg max-h-48 object-contain border border-slate-200/50"
                        />
                      ))}
                    </div>
                  )}
                  {text && (
                    m.role === "user"
                      ? <p className="whitespace-pre-wrap">{text}</p>
                      : <MarkdownRenderer content={restoreLatexEscapes(text)} />
                  )}
                  {sketches.map((s) => (
                    <AiSketch key={s.key} title={s.title} svg={s.svg} notes={s.notes} />
                  ))}
                </div>
              </div>
            );
          })
        )}

        {isBusy && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 space-y-2">
        <FormulaHelp />

        {/* Pending file thumbnails */}
        {pendingFiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-2 py-1.5">
              ⚠️ AI 視覺判讀可能會誤判（例如向量方向、相量超前後落、字跡辨識）。看到回答時請對照原圖確認；若 AI 寫的觀察跟圖不符，告訴它「你看錯了」它會重判。
            </p>
            <div className="flex flex-wrap gap-2">
            {pendingFiles.map((f, i) => {
              const url = URL.createObjectURL(f);
              return (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={f.name}
                    className="h-16 w-16 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
                    onLoad={() => URL.revokeObjectURL(url)}
                  />
                  <button
                    type="button"
                    onClick={() => removePendingFile(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-700 text-white text-xs flex items-center justify-center hover:bg-slate-900"
                    aria-label="移除"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            </div>
          </div>
        )}

        {fileError && (
          <p className="text-xs text-rose-600 dark:text-rose-300">{fileError}</p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFilePick}
        />

        <div className="flex gap-2 items-end">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            title="附加公式 / 題目照片"
            className="shrink-0 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="輸入問題或附公式照片...（$..$ / $$..$$ 寫公式）"
            className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
            disabled={isBusy}
          />
          <button
            type="submit"
            disabled={isBusy || (!input.trim() && pendingFiles.length === 0)}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            送出
          </button>
        </div>
      </form>
    </div>
  );
}
