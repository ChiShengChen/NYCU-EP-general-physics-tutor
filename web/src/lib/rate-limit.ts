/**
 * In-memory sliding-window IP rate limiter for AI routes.
 *
 * The per-student daily quota already caps how much a real user can burn
 * in tokens; this layer exists to stop a single IP from spawning N
 * anonymous student profiles and burning N × ANON_LIMIT in parallel —
 * the audit explicitly flagged that gap, since one bad actor sitting on
 * a residential IP could chew through ~500K tokens/day even with the 5K
 * anonymous cap.
 *
 * We keep the counter in module-scope on the serverless instance. A
 * single Vercel function instance is reused across requests for a few
 * minutes; the counter resets on cold start, but that's acceptable for
 * a soft burst guard — the attacker who triggers a cold start still
 * only got at most LIMIT requests on the previous instance before being
 * told to back off. Trading 100%-precise enforcement for zero extra DB
 * hops per chat request.
 *
 * If we ever need cross-instance precision, swap the Map for an
 * Upstash Redis client behind the same `checkIpRateLimit` interface.
 */

import type { NextRequest } from "next/server";

interface Bucket {
  /** Sliding window of request timestamps (ms since epoch). */
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 5 * 60 * 1000;   // 5 minutes
const LIMIT = 60;                  // 60 AI calls per IP per window
const SWEEP_INTERVAL = 5 * 60 * 1000;

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

export interface IpRateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetMs: number;   // ms until the oldest in-window hit drops out
  ip: string;
}

/** Record this request and return whether the caller is over the cap.
 *  Always increments — there's no separate "peek" path. */
export function checkIpRateLimit(req: Request | NextRequest): IpRateLimitStatus {
  const now = Date.now();
  sweep(now);
  const ip = extractIp(req);

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
    return {
      allowed: false,
      remaining: 0,
      resetMs: bucket.hits[0] + WINDOW_MS - now,
      ip,
    };
  }

  bucket.hits.push(now);
  return {
    allowed: true,
    remaining: LIMIT - bucket.hits.length,
    resetMs: WINDOW_MS,
    ip,
  };
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
