"use client";

import { useState } from "react";
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

type Mode = "teaching" | "qa" | "quiz" | "exam" | "graph" | "study-plan" | "dashboard" | "history" | "attempts" | "wrong" | null;

export default function Home() {
  const [mode, setMode] = useState<Mode>(null);

  const goHome = () => setMode(null);

  if (mode === "qa") return <Chat onBack={goHome} />;
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
  if (mode === "history") return <ChatHistory onBack={goHome} />;
  if (mode === "attempts") return <AttemptsHistory onBack={goHome} />;
  if (mode === "wrong") return <WrongNotebook onBack={goHome} />;

  return <ModeSelector onSelectMode={setMode} />;
}
