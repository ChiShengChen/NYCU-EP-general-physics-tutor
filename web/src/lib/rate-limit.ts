/**
 * Sliding-window IP rate limiter for AI routes.
 *
 * The per-student daily quota already caps how much a real user can burn
 * in tokens; this layer exists to stop a single IP from spawning N
 * anonymous student profiles and burning N × ANON_LIMIT in parallel —
 * the audit explicitly flagged that gap, since one bad actor sitting on
 * a residential IP could chew through ~500K tokens/day even with the 5K
 * anonymous cap.
 *
 * Two backends behind the same `checkIpRateLimit` interface, picked once
 * at module load:
 *
 *   - **Upstash Redis** (when `UPSTASH_REDIS_REST_URL` +
 *     `UPSTASH_REDIS_REST_TOKEN` are set): a sorted-set sliding log keyed
 *     `ratelimit:ip:<ip>`, one `/pipeline` REST call per check. Counts are
 *     shared across every Vercel instance, so the cap is actually enforced
 *     under load. Talks to Upstash with plain `fetch` — no SDK dependency.
 *
 *   - **In-memory Map** (fallback): module-scope counter on the serverless
 *     instance. A single Vercel function instance is reused across
 *     requests for a few minutes; the counter resets on cold start and is
 *     invisible to sibling instances, so it's only a soft burst guard.
 *
 * Fail-open policy: if Redis errors or doesn't answer within
 * `UPSTASH_TIMEOUT_MS`, the request is ALLOWED. We'd rather lose the burst
 * guard for a minute than lock every student out because a cache
 * provider hiccupped — the daily quota still bounds the worst case. The
 * failure is logged (throttled to once per minute so a sustained outage
 * doesn't flood the function logs) and dropped as a Sentry breadcrumb.
 */

import type { NextRequest } from "next/server";
import { addBreadcrumb } from "@/lib/sentry";

const WINDOW_MS = 5 * 60 * 1000;   // 5 minutes
const LIMIT = 60;                  // 60 AI calls per IP per window
const SWEEP_INTERVAL = 5 * 60 * 1000;
const UPSTASH_TIMEOUT_MS = 800;
const FAIL_OPEN_WARN_INTERVAL_MS = 60 * 1000;

export interface IpRateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetMs: number;   // ms until the oldest in-window hit drops out
  ip: string;
}

export type RateLimitBackend = "in-memory" | "upstash";

export interface IpRateLimiter {
  backend: RateLimitBackend;
  /** Record a hit for this IP and return whether it's over the cap.
   *  Always increments — there's no separate "peek" path. */
  check(ip: string, now?: number): Promise<IpRateLimitStatus>;
  /** Round-trip to the store (Redis PING). Resolves when the store answers,
   *  rejects otherwise. In-memory resolves immediately. */
  ping(): Promise<void>;
}

function extractIp(req: Request | NextRequest): string {
  // Vercel forwards the real client IP in x-forwarded-for. Take the
  // first hop (the original client) — later entries can be added by
  // intermediate proxies and are equally untrusted from a spoofing
  // standpoint, so we pin to the leftmost one and let the host
  // platform decide who can spoof.
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  if (first) return first;
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "anon";
}

function crumbBlocked(ip: string, hits: number): void {
  addBreadcrumb({
    category: "rate-limit",
    level: "warning",
    message: "ip rate limit exceeded",
    data: { ip, hits, limit: LIMIT },
  });
}

function crumbAllowed(ip: string, remaining: number): void {
  addBreadcrumb({
    category: "rate-limit",
    level: "info",
    message: "ip rate limit ok",
    data: { ip, remaining },
  });
}

/* ─── In-memory backend ───────────────────────────────────────────── */

interface Bucket {
  /** Sliding window of request timestamps (ms since epoch). */
  hits: number[];
}

export function createMemoryIpRateLimiter(): IpRateLimiter {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  /** Drop buckets whose newest hit fell outside the window. Keeps the Map
   *  from growing unbounded when many one-shot IPs touch the API. */
  function sweep(now: number): void {
    if (now - lastSweep < SWEEP_INTERVAL) return;
    lastSweep = now;
    const cutoff = now - WINDOW_MS;
    for (const [ip, bucket] of buckets) {
      if (bucket.hits.length === 0 || bucket.hits[bucket.hits.length - 1] < cutoff) {
        buckets.delete(ip);
      }
    }
  }

  return {
    backend: "in-memory",
    async check(ip, now = Date.now()) {
      sweep(now);

      let bucket = buckets.get(ip);
      if (!bucket) {
        bucket = { hits: [] };
        buckets.set(ip, bucket);
      }

      // Drop hits older than the window.
      const cutoff = now - WINDOW_MS;
      while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) {
        bucket.hits.shift();
      }

      if (bucket.hits.length >= LIMIT) {
        crumbBlocked(ip, bucket.hits.length);
        return {
          allowed: false,
          remaining: 0,
          resetMs: bucket.hits[0] + WINDOW_MS - now,
          ip,
        };
      }

      bucket.hits.push(now);
      const remaining = LIMIT - bucket.hits.length;
      crumbAllowed(ip, remaining);
      return { allowed: true, remaining, resetMs: WINDOW_MS, ip };
    },
    async ping() {
      /* nothing to reach */
    },
  };
}

/* ─── Upstash Redis backend (REST, no SDK) ─────────────────────────── */

export interface UpstashIpRateLimiterOptions {
  url: string;
  token: string;
  /** Injectable for tests. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Abort the Redis call after this many ms and fail open. */
  timeoutMs?: number;
  /** Injectable for tests so the once-per-minute warn throttle is observable. */
  warn?: (message: string, err: unknown) => void;
}

type UpstashCommand = Array<string | number>;
type UpstashReply = { result?: unknown; error?: string };

export function createUpstashIpRateLimiter(opts: UpstashIpRateLimiterOptions): IpRateLimiter {
  const baseUrl = opts.url.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? UPSTASH_TIMEOUT_MS;
  const warn = opts.warn ?? ((message, err) => console.warn(message, err));
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
  };
  let lastWarnAt = 0;

  /** Run a request against Upstash with an AbortController deadline.
   *  Throws on network error, timeout, non-2xx, or malformed body. */
  async function call(path: "/pipeline" | "", body: unknown): Promise<UpstashReply[]> {
    // Resolve lazily so a test that stubs `globalThis.fetch` after the
    // limiter was built still takes effect.
    const doFetch = opts.fetch ?? globalThis.fetch;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`upstash timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`upstash HTTP ${res.status}`);
      const json: unknown = await res.json();
      // The single-command endpoint answers with one object; `/pipeline`
      // with an array. Normalise to an array.
      return Array.isArray(json) ? (json as UpstashReply[]) : [json as UpstashReply];
    } finally {
      clearTimeout(timer);
    }
  }

  function failOpen(ip: string, err: unknown): IpRateLimitStatus {
    const now = Date.now();
    if (now - lastWarnAt >= FAIL_OPEN_WARN_INTERVAL_MS) {
      lastWarnAt = now;
      warn("[rate-limit] upstash unreachable — failing open (allowing requests)", err);
    }
    addBreadcrumb({
      category: "rate-limit",
      level: "warning",
      message: "ip rate limit store unavailable, failing open",
      data: { ip, backend: "upstash", error: err instanceof Error ? err.message : String(err) },
    });
    return { allowed: true, remaining: LIMIT, resetMs: WINDOW_MS, ip };
  }

  return {
    backend: "upstash",
    async check(ip, now = Date.now()) {
      const key = `ratelimit:ip:${ip}`;
      const cutoff = now - WINDOW_MS;
      const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
      const commands: UpstashCommand[] = [
        // Evict hits that fell out of the window.
        ["ZREMRANGEBYSCORE", key, 0, `(${cutoff}`],
        // Record this hit.
        ["ZADD", key, now, member],
        // How many hits (including this one) are in the window?
        ["ZCARD", key],
        // Let an idle key expire on its own so the set doesn't linger.
        ["PEXPIRE", key, WINDOW_MS],
        // Oldest in-window hit, so a blocked caller gets an honest resetMs.
        ["ZRANGE", key, 0, 0, "WITHSCORES"],
      ];

      let replies: UpstashReply[];
      try {
        replies = await call("/pipeline", commands);
      } catch (err) {
        return failOpen(ip, err);
      }

      const failed = replies.find((r) => r && typeof r.error === "string");
      if (failed) return failOpen(ip, new Error(`upstash command error: ${failed.error}`));

      const count = Number(replies[2]?.result);
      if (!Number.isFinite(count)) {
        return failOpen(ip, new Error("upstash pipeline returned no ZCARD result"));
      }

      if (count > LIMIT) {
        // ZRANGE ... WITHSCORES comes back flat: [member, score].
        const oldestRaw = replies[4]?.result;
        const oldest = Array.isArray(oldestRaw) ? Number(oldestRaw[1]) : NaN;
        const resetMs = Number.isFinite(oldest) ? Math.max(0, oldest + WINDOW_MS - now) : WINDOW_MS;
        crumbBlocked(ip, count);
        return { allowed: false, remaining: 0, resetMs, ip };
      }

      const remaining = LIMIT - count;
      crumbAllowed(ip, remaining);
      return { allowed: true, remaining, resetMs: WINDOW_MS, ip };
    },
    async ping() {
      const [reply] = await call("", ["PING"]);
      if (reply?.error) throw new Error(`upstash PING error: ${reply.error}`);
      if (reply?.result !== "PONG") throw new Error(`upstash PING answered ${JSON.stringify(reply?.result)}`);
    },
  };
}

/* ─── Module-level backend selection ──────────────────────────────── */

/** Pick the backend from env. Exported for tests; the default limiter
 *  below is what the API routes actually use. */
export interface IpRateLimitEnv {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  [key: string]: string | undefined;
}

export function selectIpRateLimiter(env: IpRateLimitEnv = process.env): IpRateLimiter {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) return createUpstashIpRateLimiter({ url, token });
  return createMemoryIpRateLimiter();
}

const limiter = selectIpRateLimiter();

/** Which store the running process is using — surfaced by /health-check. */
export function getIpRateLimitBackend(): RateLimitBackend {
  return limiter.backend;
}

/** Round-trip to the configured store (Redis PING). Rejects on failure. */
export function pingIpRateLimitStore(): Promise<void> {
  return limiter.ping();
}

/** Record this request and return whether the caller is over the cap.
 *  Always increments — there's no separate "peek" path. */
export function checkIpRateLimit(req: Request | NextRequest): Promise<IpRateLimitStatus> {
  return limiter.check(extractIp(req));
}

/** Standardised 429 body so all routes report the same shape. */
export function ipRateLimitedResponse(status: IpRateLimitStatus): {
  status: 429;
  body: { error: "ip_rate_limited"; message: string; resetSeconds: number };
} {
  return {
    status: 429,
    body: {
      error: "ip_rate_limited",
      message: "請求過於頻繁，請稍候 1–2 分鐘再試。",
      resetSeconds: Math.max(1, Math.ceil(status.resetMs / 1000)),
    },
  };
}
