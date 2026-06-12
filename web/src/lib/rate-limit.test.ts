import { describe, expect, it } from "vitest";
import { checkIpRateLimit, ipRateLimitedResponse } from "./rate-limit";

// The limiter is module-scoped, so tests share state. We use unique IPs
// per test to avoid leakage rather than reaching into the internals.
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

describe("checkIpRateLimit", () => {
  it("allows the first request and decrements remaining counter", () => {
    const ip = fakeIp();
    const r1 = checkIpRateLimit(reqWith(ip));
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(59);
    const r2 = checkIpRateLimit(reqWith(ip));
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(58);
  });

  it("blocks after the configured limit", () => {
    const ip = fakeIp();
    for (let i = 0; i < 60; i++) {
      const r = checkIpRateLimit(reqWith(ip));
      expect(r.allowed).toBe(true);
    }
    const blocked = checkIpRateLimit(reqWith(ip));
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetMs).toBeGreaterThan(0);
  });

  it("scopes counters per IP", () => {
    const ipA = fakeIp();
    const ipB = fakeIp();
    for (let i = 0; i < 60; i++) checkIpRateLimit(reqWith(ipA));
    const aBlocked = checkIpRateLimit(reqWith(ipA));
    const bAllowed = checkIpRateLimit(reqWith(ipB));
    expect(aBlocked.allowed).toBe(false);
    expect(bAllowed.allowed).toBe(true);
  });

  it("takes the leftmost IP from a multi-hop x-forwarded-for chain", () => {
    const ip = fakeIp();
    const req = new Request("https://example.com/", {
      headers: { "x-forwarded-for": `${ip}, 192.168.1.1, 10.10.10.10` },
    });
    const result = checkIpRateLimit(req);
    expect(result.ip).toBe(ip);
  });

  it("falls back to 'anon' when no IP header is present", () => {
    const req = new Request("https://example.com/");
    const result = checkIpRateLimit(req);
    expect(result.ip).toBe("anon");
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
