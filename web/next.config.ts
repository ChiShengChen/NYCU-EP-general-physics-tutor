import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * - `default-src 'self'` blocks anything we didn't explicitly opt into.
 * - Scripts/styles allow `'unsafe-inline'` because Next.js's runtime
 *   injects inline scripts for hydration + style for CSS-in-JS, and the
 *   theme bootstrap script we ship in <head> is also inline. We could
 *   harden this further by switching to nonces, but that needs a
 *   middleware refactor and is left for a future pass.
 * - `connect-src` includes the Supabase project URL (auth + storage +
 *   PostgREST + realtime) and a Brave Search endpoint that the chat
 *   route's webSearch tool occasionally calls.
 * - `img-src` allows data: URIs (KaTeX + AI sketches) and the Supabase
 *   storage bucket where lecture slide images live.
 * - `frame-ancestors 'none'` prevents the site from being framed, which
 *   blocks click-jacking attacks against the OAuth widget.
 * - `object-src 'none'` + `base-uri 'self'` close two minor XSS vectors
 *   the OWASP CSP cheat sheet calls out.
 *
 * Strict-Transport-Security pins the site to HTTPS for a year; safe
 * because Vercel always serves over TLS.
 */
const cspParts = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.search.brave.com https://generativelanguage.googleapis.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: cspParts.join("; ") },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
