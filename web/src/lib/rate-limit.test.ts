import { describe, expect, it, vi } from "vitest";
import {
  checkIpRateLimit,
  createUpstashIpRateLimiter,
  getIpRateLimitBackend,
  ipRateLimitedResponse,
  selectIpRateLimiter,
} from "./rate-limit";

// The default limiter is module-scoped, so tests share state. We use
// unique IPs per test to avoid leakage rather than reaching into the
// internals.
let nextIp = 0;
function fakeIp(): string {
  nextIp += 1;
  return `10.0.0.${nextIp}`;
}

function reqWith(ip: string): Request {
  return new Request("https://example.com/api/x", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("checkIpRateLimit (in-memory default)", () => {
  it("uses the in-memory backend when Upstash env is unset", () => {
    expect(getIpRateLimitBackend()).toBe("in-memory");
  });

  it("allows the first request and decrements remaining counter", async () => {
    const ip = fakeIp();
    const r1 = await checkIpRateLimit(reqWith(ip));
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(59);
    const r2 = await checkIpRateLimit(reqWith(ip));
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(58);
  });

  it("blocks after the configured limit", async () => {
    const ip = fakeIp();
    for (let i = 0; i < 60; i++) {
      const r = await checkIpRateLimit(reqWith(ip));
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkIpRateLimit(reqWith(ip));
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetMs).toBeGreaterThan(0);
  });

  it("scopes counters per IP", async () => {
    const ipA = fakeIp();
    const ipB = fakeIp();
    for (let i = 0; i < 60; i++) await checkIpRateLimit(reqWith(ipA));
    const aBlocked = await checkIpRateLimit(reqWith(ipA));
    const bAllowed = await checkIpRateLimit(reqWith(ipB));
    expect(aBlocked.allowed).toBe(false);
    expect(bAllowed.allowed).toBe(true);
  });

  it("takes the leftmost IP from a multi-hop x-forwarded-for chain", async () => {
    const ip = fakeIp();
    const req = new Request("https://example.com/", {
      headers: { "x-forwarded-for": `${ip}, 192.168.1.1, 10.10.10.10` },
    });
    const result = await checkIpRateLimit(req);
    expect(result.ip).toBe(ip);
  });

  it("falls back to 'anon' when no IP header is present", async () => {
    const req = new Request("https://example.com/");
    const result = await checkIpRateLimit(req);
    expect(result.ip).toBe("anon");
  });
});

describe("selectIpRateLimiter", () => {
  it("picks in-memory when either Upstash var is missing", () => {
    expect(selectIpRateLimiter({}).backend).toBe("in-memory");
    expect(selectIpRateLimiter({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io" }).backend).toBe("in-memory");
    expect(selectIpRateLimiter({ UPSTASH_REDIS_REST_TOKEN: "t" }).backend).toBe("in-memory");
    expect(selectIpRateLimiter({ UPSTASH_REDIS_REST_URL: "  ", UPSTASH_REDIS_REST_TOKEN: "t" }).backend).toBe("in-memory");
  });

  it("picks upstash when both vars are set", () => {
    const l = selectIpRateLimiter({
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "t",
    });
    expect(l.backend).toBe("upstash");
  });
});

/* ─── Upstash backend with an injected fetch ──────────────────────── */

type Reply = { result?: unknown; error?: string };

interface FakeCall {
  url: string;
  init: RequestInit;
  body: unknown;
}

/** Build a fetch stub that records calls and answers every one with the
 *  given pipeline replies. */
function fakeFetch(replies: Reply[] | (() => Reply[]), calls: FakeCall[] = []): typeof fetch & { calls: FakeCall[] } {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ url: String(input), init: init ?? {}, body });
    const payload = typeof replies === "function" ? replies() : replies;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch & { calls: FakeCall[] };
  fn.calls = calls;
  return fn;
}

/** Replies for a pipeline where ZCARD returns `count` and the oldest
 *  in-window hit has score `oldest`. */
function pipelineReplies(count: number, oldest: number): Reply[] {
  return [
    { result: 0 },                                   // ZREMRANGEBYSCORE
    { result: 1 },                                   // ZADD
    { result: count },                               // ZCARD
    { result: 1 },                                   // PEXPIRE
    { result: [`${oldest}-abc`, String(oldest)] },   // ZRANGE ... WITHSCORES
  ];
}

const URL_ = "https://fake-redis.upstash.io";
const TOKEN = "secret-token";

describe("createUpstashIpRateLimiter", () => {
  it("allows when the window count is under the limit", async () => {
    const f = fakeFetch(pipelineReplies(5, 1_000));
    const limiter = createUpstashIpRateLimiter({ url: URL_, token: TOKEN, fetch: f });
    const r = await limiter.check("1.2.3.4", 100_000);
    expect(r).toEqual({ allowed: true, remaining: 55, resetMs: 5 * 60 * 1000, ip: "1.2.3.4" });
    expect(f.calls).toHaveLength(1);
  });

  it("allows the 60th hit and blocks the 61st", async () => {
    let count = 59;
    const f = fakeFetch(() => pipelineReplies(++count, 100_000));
    const limiter = createUpstashIpRateLimiter({ url: URL_, token: TOKEN, fetch: f });

    const sixtieth = await limiter.check("1.2.3.4", 200_000);
    expect(sixtieth.allowed).toBe(true);
    expect(sixtieth.remaining).toBe(0);

    const blocked = await limiter.check("1.2.3.4", 200_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // Oldest hit was at t=100_000, window is 300_000 → resets at 400_000,
    // i.e. 200_000 ms from "now".
    expect(blocked.resetMs).toBe(200_000);
  });

  it("sends one /pipeline POST with the expected command shape", async () => {
    const f = fakeFetch(pipelineReplies(1, 100_000));
    const limiter = createUpstashIpRateLimiter({ url: `${URL_}/`, token: TOKEN, fetch: f });
    const now = 1_000_000;
    await limiter.check("9.9.9.9", now);

    expect(f.calls).toHaveLength(1);
    const [call] = f.calls;
    expect(call.url).toBe(`${URL_}/pipeline`);
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.init.signal).toBeInstanceOf(AbortSignal);

    const key = "ratelimit:ip:9.9.9.9";
    const window = 5 * 60 * 1000;
    const cmds = call.body as Array<Array<string | number>>;
    expect(cmds).toHaveLength(5);
    expect(cmds[0]).toEqual(["ZREMRANGEBYSCORE", key, 0, `(${now - window}`]);
    expect(cmds[1].slice(0, 3)).toEqual(["ZADD", key, now]);
    expect(String(cmds[1][3])).toMatch(new RegExp(`^${now}-[a-z0-9]+$`));
    expect(cmds[2]).toEqual(["ZCARD", key]);
    expect(cmds[3]).toEqual(["PEXPIRE", key, window]);
    expect(cmds[4]).toEqual(["ZRANGE", key, 0, 0, "WITHSCORES"]);
  });

  it("fails open on a network error and warns once per minute", async () => {
    const warn = vi.fn();
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const limiter = createUpstashIpRateLimiter({ url: URL_, token: TOKEN, fetch: f, warn });

    const r1 = await limiter.check("5.5.5.5");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(60);
    expect(r1.ip).toBe("5.5.5.5");

    const r2 = await limiter.check("5.5.5.5");
    expect(r2.allowed).toBe(true);

    // Two failures, but the console warning is throttled to one per minute.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/failing open/);
  });

  it("fails open when Redis does not answer before the timeout", async () => {
    const warn = vi.fn();
    const f = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
      }),
    ) as unknown as typeof fetch;
    const limiter = createUpstashIpRateLimiter({ url: URL_, token: TOKEN, fetch: f, warn, timeoutMs: 20 });

    const t0 = Date.now();
    const r = await limiter.check("6.6.6.6");
    expect(r.allowed).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toMatch(/timeout/);
  });

  it("fails open on a non-2xx response or a per-command error", async () => {
    const warn = vi.fn();
    const f500 = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const l1 = createUpstashIpRateLimiter({ url: URL_, token: TOKEN, fetch: f500, warn });
    expect((await l1.check("7.7.7.7")).allowed).toBe(true);

    const fErr = fakeFetch([{ error: "WRONGTYPE" }, { result: 1 }, { result: 1 }, { result: 1 }, { result: [] }]);
    const l2 = createUpstashIpRateLimiter({ url: URL_, token: TOKEN, fetch: fErr, warn });
    expect((await l2.check("7.7.7.7")).allowed).toBe(true);
  });

  it("ping resolves on PONG and rejects otherwise", async () => {
    const good = fakeFetch([{ result: "PONG" }]);
    const l1 = createUpstashIpRateLimiter({ url: URL_, token: TOKEN, fetch: good });
    await expect(l1.ping()).resolves.toBeUndefined();
    expect(good.calls[0].url).toBe(URL_);
    expect(good.calls[0].body).toEqual(["PING"]);

    const bad = fakeFetch([{ error: "NOAUTH" }]);
    const l2 = createUpstashIpRateLimiter({ url: URL_, token: TOKEN, fetch: bad });
    await expect(l2.ping()).rejects.toThrow(/NOAUTH/);
  });

  it("falls back to globalThis.fetch when none is injected", async () => {
    const stub = fakeFetch(pipelineReplies(2, 1));
    vi.stubGlobal("fetch", stub);
    try {
      const limiter = createUpstashIpRateLimiter({ url: URL_, token: TOKEN });
      const r = await limiter.check("8.8.8.8");
      expect(r.allowed).toBe(true);
      expect(stub.calls).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ipRateLimitedResponse", () => {
  it("returns a 429 with a friendly Chinese message", () => {
    const r = ipRateLimitedResponse({ allowed: false, remaining: 0, resetMs: 12000, ip: "x" });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("ip_rate_limited");
    expect(r.body.message).toMatch(/請求過於頻繁/);
    expect(r.body.resetSeconds).toBe(12);
  });

  it("rounds up tiny resetMs values to at least 1 second", () => {
    const r = ipRateLimitedResponse({ allowed: false, remaining: 0, resetMs: 0, ip: "x" });
    expect(r.body.resetSeconds).toBeGreaterThanOrEqual(1);
  });
});
