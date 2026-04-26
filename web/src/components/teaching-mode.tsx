"use client";

import { useChat } from "@ai-sdk/react";
import { type UIMessage, DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, useCallback, type FormEvent } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

interface ChapterInfo {
  chapter_number: number;
  page_count: number;
  sections: string[];
}

interface PageChunk {
  id: number;
  chapter_number: number;
  page_number: number;
  section_title: string;
  content: string;
  content_type: string;
  is_counterexample: boolean;
}

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

interface TeachingModeProps {
  onBack: () => void;
}

export function TeachingMode({ onBack }: TeachingModeProps) {
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pageChunks, setPageChunks] = useState<PageChunk[]>([]);
  const [loadingPage, setLoadingPage] = useState(false);

  const [studentId] = useState(() => {
    if (typeof window === "undefined") return "";
    const stored = localStorage.getItem("physics_tutor_student_id");
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem("physics_tutor_student_id", id);
    return id;
  });

  useEffect(() => {
    fetch("/api/lectures")
      .then((res) => res.json())
      .then((data) => {
        setChapters(data.chapters ?? []);
        setLoadingChapters(false);
      })
      .catch(() => setLoadingChapters(false));
  }, []);

  const handleSelectChapter = useCallback((chapterNum: number) => {
    const chapter = chapters.find((c) => c.chapter_number === chapterNum);
    setSelectedChapter(chapterNum);
    setTotalPages(chapter?.page_count ?? 0);
    setCurrentPage(1);
  }, [chapters]);

  const handleBackToChapters = useCallback(() => {
    setSelectedChapter(null);
    setCurrentPage(1);
    setPageChunks([]);
  }, []);

  if (selectedChapter === null) {
    return (
      <ChapterSelector
        chapters={chapters}
        loading={loadingChapters}
        onSelectChapter={handleSelectChapter}
        onBack={onBack}
      />
    );
  }

  return (
    <PageViewer
      chapterNumber={selectedChapter}
      currentPage={currentPage}
      totalPages={totalPages}
      pageChunks={pageChunks}
      loadingPage={loadingPage}
      studentId={studentId}
      onSetCurrentPage={setCurrentPage}
      onSetPageChunks={setPageChunks}
      onSetLoadingPage={setLoadingPage}
      onSetTotalPages={setTotalPages}
      onBackToChapters={handleBackToChapters}
      onBackToModes={onBack}
    />
  );
}

/* ───────────── Chapter Selector ───────────── */

function ChapterSelector({
  chapters,
  loading,
  onSelectChapter,
  onBack,
}: {
  chapters: ChapterInfo[];
  loading: boolean;
  onSelectChapter: (chapter: number) => void;
  onBack: () => void;
}) {
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
        <span className="text-xl">📖</span>
        <h1 className="text-lg font-semibold text-slate-800">教學模式 — 選擇章節</h1>
        <span className="text-xs text-slate-400 ml-auto">NYCU 電物系</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-400">載入中...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {chapters.map((chapter) => (
              <button
                key={chapter.chapter_number}
                onClick={() => onSelectChapter(chapter.chapter_number)}
                className="group flex flex-col text-left p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-lg font-semibold text-slate-800">
                    Ch{String(chapter.chapter_number).padStart(2, "0")}
                  </span>
                  <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
                    {chapter.page_count} 頁
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {chapter.sections.slice(0, 3).map((section) => (
                    <span
                      key={section}
                      className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full truncate max-w-[180px]"
                    >
                      {section}
                    </span>
                  ))}
                  {chapter.sections.length > 3 && (
                    <span className="text-xs text-slate-400">
                      +{chapter.sections.length - 3} more
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── Page Viewer ───────────── */

function PageViewer({
  chapterNumber,
  currentPage,
  totalPages,
  pageChunks,
  loadingPage,
  studentId,
  onSetCurrentPage,
  onSetPageChunks,
  onSetLoadingPage,
  onSetTotalPages,
  onBackToChapters,
  onBackToModes,
}: {
  chapterNumber: number;
  currentPage: number;
  totalPages: number;
  pageChunks: PageChunk[];
  loadingPage: boolean;
  studentId: string;
  onSetCurrentPage: (page: number) => void;
  onSetPageChunks: (chunks: PageChunk[]) => void;
  onSetLoadingPage: (loading: boolean) => void;
  onSetTotalPages: (total: number) => void;
  onBackToChapters: () => void;
  onBackToModes: () => void;
}) {
  const [input, setInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [chatKey, setChatKey] = useState(0);
  const hasSentInitial = useRef(false);

  // Create transport that passes teaching mode params
  const [transport, setTransport] = useState(
    () =>
      new DefaultChatTransport({
        body: () => ({
          mode: "teaching",
          chapterNumber,
          pageNumber: currentPage,
          studentId,
        }),
      }),
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    id: `teaching-${chapterNumber}-${currentPage}-${chatKey}`,
  });
  const isBusy = status === "streaming" || status === "submitted";

  // Fetch page content and reset chat when page changes
  useEffect(() => {
    hasSentInitial.current = false;
    onSetLoadingPage(true);

    // Recreate transport for new page
    setTransport(
      new DefaultChatTransport({
        body: () => ({
          mode: "teaching",
          chapterNumber,
          pageNumber: currentPage,
          studentId,
        }),
      }),
    );
    setChatKey((k) => k + 1);

    // Fetch page chunks
    fetch(`/api/lectures?chapter=${chapterNumber}&page=${currentPage}`)
      .then((res) => res.json())
      .then((data) => {
        onSetPageChunks(data.chunks ?? []);
        onSetLoadingPage(false);
      })
      .catch(() => onSetLoadingPage(false));

    // Also fetch total pages if we don't have it yet
    if (totalPages === 0) {
      fetch(`/api/lectures?chapter=${chapterNumber}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.pages) {
            onSetTotalPages(data.pages.length);
          }
        });
    }
  }, [chapterNumber, currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send initial explanation request after page loads and chat is ready
  useEffect(() => {
    if (!loadingPage && pageChunks.length > 0 && messages.length === 0 && !hasSentInitial.current && !isBusy) {
      hasSentInitial.current = true;
      // Small delay to ensure transport is ready
      const timer = setTimeout(() => {
        sendMessage({ text: "請解說這一頁的內容" });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [loadingPage, pageChunks, messages.length, isBusy, sendMessage]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    setInput("");
    sendMessage({ text });
  };

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      onSetCurrentPage(page);
    }
  };

  // Build page content markdown
  const pageContent = pageChunks
    .map((c) => {
      const prefix = c.is_counterexample ? "> ⚠️ **此為反例/錯誤示範**\n\n" : "";
      const sectionHeader = c.section_title ? `### ${c.section_title}\n\n` : "";
      return `${sectionHeader}${prefix}${c.content}`;
    })
    .join("\n\n---\n\n");

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <button
          onClick={onBackToChapters}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
          aria-label="返回章節選擇"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">📖</span>
        <h1 className="text-lg font-semibold text-slate-800">Ch{String(chapterNumber).padStart(2, "0")}</h1>
        <span className="text-sm text-slate-500">
          Page {currentPage} / {totalPages || "..."}
        </span>
        <button
          onClick={onBackToModes}
          className="ml-auto text-xs text-slate-500 hover:text-indigo-600 transition-colors"
        >
          返回選擇模式
        </button>
      </header>

      {/* Main Content: Side-by-side on desktop, stacked on mobile */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left: Original Slide Image */}
        <div className="md:w-1/2 border-b md:border-b-0 md:border-r border-slate-200 flex flex-col">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
            <h2 className="text-sm font-medium text-slate-600">📄 講義投影片</h2>
          </div>
          <div className="flex-1 overflow-y-auto flex items-start justify-center bg-slate-100 p-2">
            <img
              src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/slides/ch_${chapterNumber}_page_${currentPage}.jpg`}
              alt={`Ch${String(chapterNumber).padStart(2, "0")} Page ${currentPage}`}
              className="max-w-full h-auto rounded-lg shadow-sm"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="flex items-center justify-center h-32 text-slate-400">此頁無投影片</div>';
              }}
            />
          </div>
        </div>

        {/* Right: AI Chat */}
        <div className="md:w-1/2 flex flex-col">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
            <h2 className="text-sm font-medium text-slate-600">🤖 AI 解說</h2>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && !isBusy ? (
              <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
                AI 正在準備解說...
              </div>
            ) : (
              messages.map((m) => {
                const text = getTextContent(m);
                if (!text) return null;
                return (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[90%] rounded-2xl px-4 py-2.5 ${
                        m.role === "user"
                          ? "bg-indigo-600 text-white rounded-br-sm"
                          : "bg-white border border-slate-200 shadow-sm rounded-bl-sm"
                      }`}
                    >
                      {m.role === "user" ? (
                        <p className="whitespace-pre-wrap text-sm">{text}</p>
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

          {/* Chat input for follow-up questions */}
          <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="追問這一頁的內容..."
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                disabled={isBusy}
              />
              <button
                type="submit"
                disabled={isBusy || !input.trim()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                送出
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Page Navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white shrink-0">
        <button
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="flex items-center gap-1 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden sm:inline">上一頁</span>
        </button>

        {/* Mobile: select dropdown */}
        <select
          value={currentPage}
          onChange={(e) => goToPage(Number(e.target.value))}
          className="sm:hidden rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <option key={p} value={p}>第 {p} 頁 / {totalPages}</option>
          ))}
        </select>

        {/* Desktop: page dots */}
        <div className="hidden sm:flex gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => goToPage(p)}
              className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                p === currentPage
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="flex items-center gap-1 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span className="hidden sm:inline">下一頁</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
