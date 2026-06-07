"use client";

import { SWRConfig } from "swr";
import { apiFetcher } from "@/lib/api";

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
    </SWRConfig>
  );
}
