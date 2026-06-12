"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Press-to-talk button backed by the browser's Web Speech API.
 *
 * Why this instead of Whisper / server-side STT: zero infra, zero
 * token quota, ~instant transcription on Chrome/Edge/Safari without
 * sending audio off-device. The fallback for browsers without
 * SpeechRecognition (mainly Firefox) is to hide the button — students
 * can always type. A future iteration could record audio + POST to a
 * Whisper-backed `/api/transcribe` route for Firefox parity.
 *
 * UX: tap to start, tap again to stop. Interim results stream into
 * `onPartial` so the chat input shows what the user is saying; the
 * final string is delivered via `onFinal` once the engine commits.
 * Language pinned to zh-TW because the course is in Traditional
 * Chinese; switching dynamically would need a UI we don't have yet.
 */

// The DOM lib for SpeechRecognition is not always present on the
// global window type; this minimal declaration is enough for what we
// actually use.
type SpeechRecognitionEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Props {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

export function VoiceInputButton({ onPartial, onFinal, disabled, className }: Props) {
  const Ctor = getSpeechRecognition();
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  // Always release the microphone when the component unmounts mid-listen.
  useEffect(() => () => recRef.current?.stop(), []);

  const start = useCallback(() => {
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "zh-TW";
    rec.continuous = false;
    rec.interimResults = true;

    let lastFinal = "";
    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const alt = event.results[i][0];
        if (event.results[i].isFinal) {
          final += alt.transcript;
        } else {
          interim += alt.transcript;
        }
      }
      if (final && final !== lastFinal) lastFinal = final;
      onPartial?.((lastFinal + interim).trim());
    };
    rec.onerror = (e) => {
      console.warn("[voice] speech recognition error:", e.error);
    };
    rec.onend = () => {
      setListening(false);
      const text = lastFinal.trim();
      if (text) onFinal(text);
    };

    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [Ctor, onPartial, onFinal]);

  if (!Ctor) return null;

  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      disabled={disabled}
      title={listening ? "停止錄音" : "語音輸入（中文）"}
      aria-pressed={listening}
      className={
        className ??
        `shrink-0 rounded-xl border p-2 transition-colors disabled:opacity-40 ${
          listening
            ? "border-rose-400 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300"
            : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        }`
      }
    >
      {listening ? (
        // pulsing mic-on indicator
        <svg className="w-5 h-5 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1a3 3 0 00-3 3v6a3 3 0 006 0V4a3 3 0 00-3-3z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10v1a7 7 0 01-14 0v-1M12 18v4M8 22h8" />
        </svg>
      )}
    </button>
  );
}
