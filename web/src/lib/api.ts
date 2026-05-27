/**
 * Lightweight client-side fetch helpers shared across SWR hooks and ad-hoc
 * fetches. Centralizing this gets us:
 *   - one place to throw on non-2xx (so SWR's `error` is populated reliably);
 *   - one place to evolve credentials / common headers later (e.g. when we
 *     swap localStorage studentId for a server session);
 *   - a consistent way to build cache keys from query params, with built-in
 *     "skip the fetch if a required param is missing" semantics so callers
 *     don't have to scatter null-guards through each useSWR call.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetcher<T = unknown>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // response wasn't JSON; that's fine, body stays undefined
    }
    throw new ApiError(`Request failed: ${res.status}`, res.status, body);
  }
  return (await res.json()) as T;
}

/**
 * Build an SWR cache key from a path + params. Returning `null` is the SWR
 * convention for "don't fetch yet" — we use it whenever a required param
 * is missing so callers can write:
 *
 *   const { data } = useSWR(apiKey("/api/dashboard", { studentId }));
 *
 * without having to wrap that in a `studentId ? ... : null` themselves.
 */
export function apiKey(
  path: string,
  params?: Record<string, string | number | null | undefined>,
): string | null {
  if (!params) return path;
  const total = Object.keys(params).length;
  const present = Object.entries(params).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (present.length !== total) return null;
  if (present.length === 0) return path;
  const qs = new URLSearchParams(present.map(([k, v]) => [k, String(v)]));
  return `${path}?${qs.toString()}`;
}
