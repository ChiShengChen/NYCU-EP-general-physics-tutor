"use client";

import { useSyncExternalStore } from "react";

/**
 * Read the current student id from localStorage in a way that:
 *
 *   1. Doesn't trip the React 19 `set-state-in-effect` lint rule the way
 *      a useEffect → setState read does. useSyncExternalStore is the
 *      sanctioned hook for "snapshot an external store on the client",
 *      and React renders the right value on first paint without a
 *      cascading render.
 *   2. Stays SSR-safe — the server snapshot is always `null`, which the
 *      callers already treat as "no student yet" via apiKey()'s
 *      missing-param skip.
 *   3. Cross-tab updates (e.g. another tab calls /api/auth/sync and
 *      writes a new id) propagate via the native `storage` event.
 *      Same-tab updates aren't picked up because none of our writers
 *      need that — they happen as part of an explicit sign-in flow that
 *      navigates / reloads anyway.
 *
 * This is intentionally read-only. Components that lazily mint a new
 * UUID when none exists keep their own useState initializer for now —
 * mixing read-or-create semantics into a snapshot hook would muddy it.
 */

const STUDENT_ID_KEY = "physics_tutor_student_id";

function subscribe(notify: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

function getSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STUDENT_ID_KEY);
}

function getServerSnapshot(): string | null {
  return null;
}

export function useStudentId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
