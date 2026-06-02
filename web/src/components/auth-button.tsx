"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

const STUDENT_ID_KEY = "physics_tutor_student_id";

export function AuthButton({ className = "" }: { className?: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const runSync = useCallback(async () => {
    setMerging(true);
    try {
      const localStudentId = localStorage.getItem(STUDENT_ID_KEY) ?? undefined;
      const res = await fetch("/api/auth/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localStudentId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast(`同步失敗：${err.error ?? res.status}`);
        return;
      }
      const { studentId, mergedAnonymous, isNewAccount } = (await res.json()) as {
        studentId: string;
        mergedAnonymous: boolean;
        isNewAccount?: boolean;
      };
      if (studentId && studentId !== localStudentId) {
        localStorage.setItem(STUDENT_ID_KEY, studentId);
      }
      const msg = mergedAnonymous
        ? "已將本機學習紀錄連到此 Google 帳號 ✓"
        : isNewAccount
          ? "歡迎！已建立帳號 ✓"
          : "已登入 ✓";
      setToast(msg);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setMerging(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) {
        setUser(data.user);
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "SIGNED_IN") {
        runSync();
      }
      if (event === "SIGNED_OUT") {
        // Do NOT delete the localStorage student_id — anonymous mode continues
        // to work on this device after sign-out using the same profile row.
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [runSync]);

  async function signIn(provider: "google" | "github") {
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${origin}/auth/callback` },
    });
    if (error) setToast(`登入失敗：${error.message}`);
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setToast("已登出");
    setTimeout(() => setToast(null), 2500);
  }

  if (loading) {
    return <div className={`text-xs text-slate-400 dark:text-slate-500 ${className}`}>…</div>;
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {toast && (
        <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[260px] truncate">{toast}</span>
      )}
      {user ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600 dark:text-slate-300 hidden sm:inline max-w-[160px] truncate">
            {user.user_metadata?.full_name ?? user.email}
          </span>
          <button
            onClick={signOut}
            className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            登出
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => signIn("google")}
            disabled={merging}
            title="以 Google 登入"
            aria-label="以 Google 登入"
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4C12.9 4 4 12.9 4 24s8.9 20 20 20s20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 13 24 13c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4C16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.1 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2C40.7 35.5 44 30 44 24c0-1.3-.1-2.3-.4-3.5z" />
            </svg>
            <span className="hidden sm:inline">Google</span>
          </button>
          <button
            onClick={() => signIn("github")}
            disabled={merging}
            title="以 GitHub 登入"
            aria-label="以 GitHub 登入"
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            <span className="hidden sm:inline">GitHub</span>
          </button>
        </div>
      )}
    </div>
  );
}
