"use client";

import { useCallback, useEffect, useState } from "react";
import type { UIMessage } from "ai";
import { Chat } from "@/components/chat";
import { ModeSelector } from "@/components/mode-selector";
import { TeachingMode } from "@/components/teaching-mode";
import { QuizMode } from "@/components/quiz-mode";
import { ExamMode } from "@/components/exam-mode";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { StudyPlanView } from "@/components/study-plan";
import { Dashboard } from "@/components/dashboard";
import { ChatHistory } from "@/components/chat-history";
import { AttemptsHistory } from "@/components/attempts-history";
import { WrongNotebook } from "@/components/wrong-notebook";
import { ChapterPreview } from "@/components/chapter-preview";
import { FeynmanMode } from "@/components/feynman-mode";
import { CalibrationView } from "@/components/calibration-view";
import { DailyReview } from "@/components/daily-review";
import { ConceptCompare } from "@/components/concept-compare";
import { ReflectionJournal } from "@/components/reflection-journal";
import { LibraryView } from "@/components/library-view";
import { GoalsView } from "@/components/goals-view";

type Mode = "teaching" | "qa" | "quiz" | "exam" | "graph" | "study-plan" | "dashboard" | "history" | "attempts" | "wrong" | "preview" | "feynman" | "calibration" | "daily" | "compare" | "reflection" | "library" | "goals" | null;

interface ResumeState {
  /** Unique key per resume action, used to re-init useChat. */
  key: number;
  messages: UIMessage[];
  /** If set, chat auto-sends this message once after mount. */
  pendingMessage?: string;
  /** Original DB session_id of the resumed conversation, so new turns
   *  written during the resume join the same session group. */
  sessionId?: string;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);
  /** Active session id for the 自由問答 view. Fresh QA entry mints a new
   *  one; resume reuses the original. Stamped on every chat_messages row. */
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);

  const goHome = useCallback(() => {
    setMode(null);
    setResume(null);
    setChatSessionId(null);
  }, []);

  // ModeSelector dispatcher: intercept "qa" cold-entry to mint a new session.
  const onSelectMode = useCallback((m: NonNullable<Mode>) => {
    if (m === "qa") {
      setResume(null);
      setChatSessionId(crypto.randomUUID());
    }
    setMode(m);
  }, []);

  // Global keyboard shortcuts:
  //   - 1–9 on the home screen → jump to the corresponding mode (matches
  //     the badges on ModeSelector cards).
  //   - Esc on any detail screen → go home (matches the back arrow).
  //   - Cmd/Ctrl+Enter inside a <form> → submit. Lets students send chat
  //     messages, reflections, etc. without reaching for the mouse, and
  //     works uniformly across <input> and multi-line <textarea>.
  useEffect(() => {
    const KEY_TO_MODE: Record<string, NonNullable<Mode>> = {
      "1": "preview",
      "2": "teaching",
      "3": "qa",
      "4": "quiz",
      "5": "feynman",
      "6": "exam",
      "7": "graph",
      "8": "study-plan",
      "9": "daily",
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;  // don't hijack IME composition
      const target = e.target as HTMLElement | null;

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const form = target?.closest?.("form") as HTMLFormElement | null;
        if (form) {
          e.preventDefault();
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.submit();
        }
        return;
      }

      if (e.key === "Escape" && mode !== null) {
        e.preventDefault();
        goHome();
        return;
      }

      if (mode === null && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const inEditable = !!target?.closest?.("input, textarea, [contenteditable='true']");
        if (inEditable) return;
        const next = KEY_TO_MODE[e.key];
        if (next) {
          e.preventDefault();
          onSelectMode(next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, goHome, onSelectMode]);

  if (mode === "qa") {
    return (
      <Chat
        onBack={goHome}
        initialMessages={resume?.messages}
        resumeKey={resume?.key}
        pendingMessage={resume?.pendingMessage}
        sessionId={chatSessionId ?? undefined}
      />
    );
  }
  if (mode === "teaching") return <TeachingMode onBack={goHome} />;
  if (mode === "quiz") return <QuizMode onBack={goHome} />;
  if (mode === "exam") return <ExamMode onBack={goHome} />;
  if (mode === "graph") {
    return (
      <KnowledgeGraph
        onBack={goHome}
        onNavigate={(targetMode, _chapter) => {
          if (targetMode === "teaching") setMode("teaching");
        }}
      />
    );
  }
  if (mode === "study-plan") return <StudyPlanView onBack={goHome} />;
  if (mode === "dashboard") return <Dashboard onBack={goHome} />;
  if (mode === "history") {
    return (
      <ChatHistory
        onBack={goHome}
        onResume={(_idx, messages, pendingMessage, sessionDbId) => {
          // Convert DB rows to UIMessage shape that useChat expects.
          const uiMessages: UIMessage[] = messages.map((m) => ({
            id: `hist-${m.id}`,
            role: m.role,
            parts: [{ type: "text", text: m.content }],
          }));
          setResume({ key: Date.now(), messages: uiMessages, pendingMessage, sessionId: sessionDbId ?? undefined });
          // Continue writing into the same DB session if we have it; mint a
          // fresh one only for legacy null-session_id resumes.
          setChatSessionId(sessionDbId ?? crypto.randomUUID());
          setMode("qa");
        }}
      />
    );
  }
  if (mode === "attempts") return <AttemptsHistory onBack={goHome} />;
  if (mode === "wrong") return <WrongNotebook onBack={goHome} />;
  if (mode === "preview") return <ChapterPreview onBack={goHome} />;
  if (mode === "feynman") return <FeynmanMode onBack={goHome} />;
  if (mode === "calibration") return <CalibrationView onBack={goHome} />;
  if (mode === "daily") return <DailyReview onBack={goHome} />;
  if (mode === "compare") return <ConceptCompare onBack={goHome} />;
  if (mode === "reflection") return <ReflectionJournal onBack={goHome} />;
  if (mode === "library") return <LibraryView onBack={goHome} />;
  if (mode === "goals") return <GoalsView onBack={goHome} />;

  return <ModeSelector onSelectMode={onSelectMode} />;
}
