"use client";

import { useChat } from "@ai-sdk/react";
import { type UIMessage, DefaultChatTransport } from "ai";
import { useRef, useEffect, useMemo, useState, useCallback, useSyncExternalStore, type FormEvent } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { restoreLatexEscapes, stripMetaCommentary } from "@/lib/restore-latex";
import { TeachingSimEmbed } from "./teaching-sim-embed";
import { ThemeToggle } from "./theme-provider";

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

/* Module-scoped external store for the slide-pane visibility toggle. Lives
 * outside the component so `notifySlideVisible` from one click rerenders
 * any other TeachingMode instance on the page (and survives swap-prop
 * navigation). Same-tab writes don't fire `storage` events, so we keep
 * our own listener set and ping it after each setItem. */
const SLIDE_KEY = "physics_tutor_slide_visible";
const slideListeners = new Set<() => void>();
function readSlideVisible(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(SLIDE_KEY) !== "0";
}
function subscribeSlideVisible(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  slideListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    slideListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function notifySlideVisible(): void {
  slideListeners.forEach((cb) => cb());
}

interface TeachingModeProps {
  onBack: () => void;
  /** Pre-select this chapter on mount instead of showing the chapter
   *  picker. Used when the user enters via a deep link from the concept
   *  graph or the prereq-gap analyzer ("→ 進入教學模式複習這章"). */
  initialChapter?: number;
}

export function TeachingMode({ onBack, initialChapter }: TeachingModeProps) {
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(initialChapter ?? null);
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
        const list = (data.chapters ?? []) as ChapterInfo[];
        setChapters(list);
        setLoadingChapters(false);
        // When entering via a deep link (initialChapter), the constructor
        // pre-selected the chapter but couldn't know the page count yet.
        // Resolve it once the metadata arrives.
        if (initialChapter !== undefined) {
          const meta = list.find((c) => c.chapter_number === initialChapter);
          if (meta) setTotalPages(meta.page_count);
        }
      })
      .catch(() => setLoadingChapters(false));
  }, [initialChapter]);

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
        <span className="text-xl">📖</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">教學模式 — 選擇章節</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">NYCU 電物系</span>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-400 dark:text-slate-500">載入中...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {chapters.map((chapter) => (
              <button
                key={chapter.chapter_number}
                onClick={() => onSelectChapter(chapter.chapter_number)}
                className="group flex flex-col text-left p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:border-indigo-700 hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                    Ch{String(chapter.chapter_number).padStart(2, "0")}
                  </span>
                  <span className="text-xs bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                    {chapter.page_count} 頁
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {chapter.sections.slice(0, 3).map((section) => (
                    <span
                      key={section}
                      className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full truncate max-w-[180px]"
                    >
                      {section}
                    </span>
                  ))}
                  {chapter.sections.length > 3 && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">
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
  const hasSentInitial = useRef(false);

  // Slide pane visibility — collapsed gives the chat full width, which is
  // much friendlier for long math expressions and AI explanations.
  // Preference persists across page navigation via localStorage, read
  // through useSyncExternalStore so initial paint sees the right value
  // without a re-render cascade.
  const slideVisible = useSyncExternalStore(
    subscribeSlideVisible,
    readSlideVisible,
    () => true,
  );
  const setSlideVisible = useCallback((v: boolean) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("physics_tutor_slide_visible", v ? "1" : "0");
    }
    notifySlideVisible();
  }, []);

  // Transport that passes teaching-mode params. Derived via useMemo so
  // it's rebuilt automatically when the page (or chapter or student)
  // changes — that avoids a setTransport-in-effect lint hit and keeps
  // useChat's transport identity stable between page changes when only
  // unrelated state moves.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        body: () => ({
          mode: "teaching",
          chapterNumber,
          pageNumber: currentPage,
          studentId,
        }),
      }),
    [chapterNumber, currentPage, studentId],
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    id: `teaching-${chapterNumber}-${currentPage}`,
  });
  const isBusy = status === "streaming" || status === "submitted";

  // Fetch page content and reset chat when page changes. The useChat id
  // includes chapterNumber + currentPage, so message history resets
  // automatically on navigation — no manual key bump needed here.
  useEffect(() => {
    hasSentInitial.current = false;
    onSetLoadingPage(true);

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

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <button
          onClick={onBackToChapters}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
          aria-label="返回章節選擇"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl">📖</span>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Ch{String(chapterNumber).padStart(2, "0")}</h1>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          Page {currentPage} / {totalPages || "..."}
        </span>
        <button
          onClick={onBackToModes}
          className="ml-auto text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:text-indigo-300 transition-colors"
        >
          返回選擇模式
        </button>
        <ThemeToggle />
      </header>

      {/* Main Content: Side-by-side on desktop, stacked on mobile.
          Slide pane is collapsible so chat can take the full width — much
          friendlier for long math expressions that wrap awkwardly in half. */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left: Original Slide Image */}
        {slideVisible && (
          <div className="md:w-1/2 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 flex flex-col">
            <div className="flex items-center px-3 py-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <h2 className="text-sm font-medium text-slate-600 dark:text-slate-300">📄 講義投影片</h2>
              <button
                onClick={() => setSlideVisible(false)}
                title="收合投影片，讓 AI 對話佔滿畫面"
                className="ml-auto text-xs px-2 py-0.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:text-indigo-300 hover:bg-white dark:bg-slate-900 border border-transparent hover:border-slate-200 dark:border-slate-700 transition-colors"
              >
                收合 ▸
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-800 p-2">
              <div className="flex items-start justify-center">
                {/* Plain <img> on purpose — the slide URL is built per-page from
                    a Supabase Storage public path, which next/image's loader
                    would need extra remote-pattern config + custom loader to
                    accept; the slide is also already a hand-sized JPEG so
                    LCP optimization buys little here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/slides/ch_${chapterNumber}_page_${currentPage}.jpg`}
                  alt={`Ch${String(chapterNumber).padStart(2, "0")} Page ${currentPage}`}
                  className="max-w-full h-auto rounded-lg shadow-sm"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                    (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="flex items-center justify-center h-32 text-slate-400 dark:text-slate-500">此頁無投影片</div>';
                  }}
                />
              </div>
              {/* Inline simulator if this chapter/page has one mapped. */}
              <TeachingSimEmbed chapter={chapterNumber} page={currentPage} />
            </div>
          </div>
        )}

        {/* Right: AI Chat */}
        <div className={`${slideVisible ? "md:w-1/2" : "w-full"} flex flex-col`}>
          <div className="flex items-center px-3 py-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shrink-0">
            {!slideVisible && (
              <button
                onClick={() => setSlideVisible(true)}
                title="展開投影片"
                className="mr-2 text-xs px-2 py-0.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:text-indigo-300 hover:bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                ◂ 顯示投影片
              </button>
            )}
            <h2 className="text-sm font-medium text-slate-600 dark:text-slate-300">🤖 AI 解說</h2>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && !isBusy ? (
              <div className="flex items-center justify-center h-32 text-slate-400 dark:text-slate-500 text-sm">
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
                          : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-bl-sm"
                      }`}
                    >
                      {m.role === "user" ? (
                        <p className="whitespace-pre-wrap text-sm">{text}</p>
                      ) : (
                        <MarkdownRenderer content={restoreLatexEscapes(stripMetaCommentary(text))} />
                      )}
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

          {/* Chat input for follow-up questions */}
          <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="追問這一頁的內容..."
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
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
      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <button
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="flex items-center gap-1 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
          className="sm:hidden rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="flex items-center gap-1 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
