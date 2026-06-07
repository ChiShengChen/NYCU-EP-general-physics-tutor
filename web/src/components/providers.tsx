"use client";

import { SWRConfig } from "swr";
import { apiFetcher } from "@/lib/api";
import { ThemeToggle } from "./theme-provider";

/**
 * App-wide client providers. Currently:
 *
 * - **SWRConfig**: every `useSWR(key)` call falls through to `apiFetcher`
 *   unless overridden, so components don't repeat the fetcher wiring.
 *   `revalidateOnFocus` is off because the app's data (mastery scores,
 *   stats, study plans) doesn't change minute-to-minute and refetching
 *   whenever a tab regains focus made the dashboard feel jittery during
 *   testing. `dedupingInterval` of 30s coalesces the half-dozen
 *   `studentId`-keyed home requests fired during a single navigation.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: apiFetcher,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 30_000,
      }}
    >
      {children}
      {/* Global floating dark/light toggle — pinned bottom-right so every
          mode (not just the home picker) can flip themes without us having
          to wire <ThemeToggle /> into 20-odd per-page headers. Backdrop
          blur + shadow lift it off whatever's underneath, and z-50 keeps
          it above sim canvases / chat scroll panes. */}
      <div className="fixed bottom-3 right-3 z-50 rounded-xl bg-white/85 dark:bg-slate-900/85 backdrop-blur shadow-md border border-slate-200 dark:border-slate-700">
        <ThemeToggle />
      </div>
    </SWRConfig>
  );
}
