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
 *   3. Propagates both cross-tab and same-tab updates. The browser's
 *      native `storage` event only fires across tabs, so a sign-in flow
 *      that writes a new id via /api/auth/sync would leave the current
 *      tab reading the stale value until a reload. `notifyStudentId()`
 *      fires a custom event that the in-tab subscribers also pick up,
 *      so the auth-button toast → useSWR re-key → UI refresh chain
 *      completes immediately.
 */

const STUDENT_ID_KEY = "physics_tutor_student_id";
const SAME_TAB_EVENT = "physics_tutor_student_id_change";

function subscribe(notify: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", notify);
  window.addEventListener(SAME_TAB_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(SAME_TAB_EVENT, notify);
  };
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

/**
 * Call after writing a new value to `localStorage[STUDENT_ID_KEY]` from
 * the same tab (e.g. the auth-button's `/api/auth/sync` flow) so any
 * `useStudentId()` subscribers in this tab re-render. Cross-tab updates
 * are still handled automatically by the native `storage` event.
 */
export function notifyStudentIdChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SAME_TAB_EVENT));
}
