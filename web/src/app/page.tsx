"use client";

import { useState } from "react";
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

type Mode = "teaching" | "qa" | "quiz" | "exam" | "graph" | "study-plan" | "dashboard" | "history" | "attempts" | "wrong" | "preview" | null;

interface ResumeState {
  /** Unique key per resume action, used to re-init useChat. */
  key: number;
  messages: UIMessage[];
  /** If set, chat auto-sends this message once after mount. */
  pendingMessage?: string;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);

  const goHome = () => {
    setMode(null);
    setResume(null);
  };

  if (mode === "qa") {
    return (
      <Chat
        onBack={goHome}
        initialMessages={resume?.messages}
        resumeKey={resume?.key}
        pendingMessage={resume?.pendingMessage}
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
        onResume={(_sessionId, messages, pendingMessage) => {
          // Convert DB rows to UIMessage shape that useChat expects.
          const uiMessages: UIMessage[] = messages.map((m) => ({
            id: `hist-${m.id}`,
            role: m.role,
            parts: [{ type: "text", text: m.content }],
          }));
          setResume({ key: Date.now(), messages: uiMessages, pendingMessage });
          setMode("qa");
        }}
      />
    );
  }
  if (mode === "attempts") return <AttemptsHistory onBack={goHome} />;
  if (mode === "wrong") return <WrongNotebook onBack={goHome} />;
  if (mode === "preview") return <ChapterPreview onBack={goHome} />;

  return <ModeSelector onSelectMode={setMode} />;
}
