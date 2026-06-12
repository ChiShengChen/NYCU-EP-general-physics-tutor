/**
 * Lightweight Sentry-style error reporting hook.
 *
 * We don't ship the full `@sentry/nextjs` SDK (yet) because (a) it
 * bumps the bundle / cold-start cost and (b) we don't actually need
 * per-request transaction tracing. What we need today is "when an
 * API route throws or returns 500, send the error somewhere we can
 * see it on a dashboard". The minimal contract here is just that.
 *
 * Activation: set `SENTRY_DSN` (server) and/or `NEXT_PUBLIC_SENTRY_DSN`
 * (client) in the env. When unset, every helper is a no-op so dev /
 * preview environments don't accidentally spam a project. When set,
 * errors are POSTed directly to Sentry's Store API endpoint without
 * needing the SDK. Wired into the API route try/catches via
 * `captureRouteError` and into the browser via `setupClientErrorHook`.
 *
 * Breadcrumbs: each route opens its own scope via `initBreadcrumbs()`
 * at handler entry, then drops `addBreadcrumb()` markers at meaningful
 * stages (rate-limit hit, RAG fetch, model call, etc). When the route
 * later throws, captureRouteError attaches the accumulated trail so
 * Sentry shows "this is where the request was when it died" rather
 * than just the bare exception. Per-request isolation is handled by
 * AsyncLocalStorage so we don't need to thread a context object
 * through every helper signature.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface ServerContext {
  endpoint: string;
  studentId?: string | null;
  meta?: Record<string, unknown>;
}

export interface Breadcrumb {
  // Standard Sentry categories: "http", "db", "auth", "ai.call", etc.
  // Anything string is fine; the Sentry UI groups by exact match.
  category: string;
  message?: string;
  level?: "debug" | "info" | "warning" | "error";
  // Small structured payload (token counts, model name, status). Keep
  // it scalar — Sentry shows this verbatim and large objects make the
  // breadcrumb panel unreadable.
  data?: Record<string, string | number | boolean | null>;
}

interface StoredBreadcrumb extends Breadcrumb {
  timestamp: string;
}

const BREADCRUMB_LIMIT = 50;
const breadcrumbStore = new AsyncLocalStorage<StoredBreadcrumb[]>();

/**
 * Open a breadcrumb scope for the current async context. Call once at
 * the top of every route handler that wants Sentry breadcrumbs. Safe
 * to call multiple times — only the first call wins per request.
 */
export function initBreadcrumbs(): void {
  if (breadcrumbStore.getStore()) return;
  breadcrumbStore.enterWith([]);
}

/**
 * Push a breadcrumb onto the current scope. No-op (and no warning) if
 * called outside `initBreadcrumbs()` — that way third-party helpers
 * can drop breadcrumbs unconditionally without forcing every consumer
 * to opt in.
 */
export function addBreadcrumb(crumb: Breadcrumb): void {
  const store = breadcrumbStore.getStore();
  if (!store) return;
  store.push({ ...crumb, timestamp: new Date().toISOString() });
  // Ring-buffer cap so a long-running request can't blow up the
  // captured payload size if it logs in a tight loop.
  if (store.length > BREADCRUMB_LIMIT) store.shift();
}

const SENTRY_DSN = process.env.SENTRY_DSN;
const ENV = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

// Parse the DSN once. Sentry DSNs look like
// "https://<key>@<host>/<project>", which we split into the public key
// + the URL of the project's envelope endpoint.
function parseDsn(dsn: string): { url: string; publicKey: string; projectId: string } | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) return null;
    const url = `${u.protocol}//${u.host}/api/${projectId}/envelope/`;
    return { url, publicKey, projectId };
  } catch {
    return null;
  }
}

const serverDsn = SENTRY_DSN ? parseDsn(SENTRY_DSN) : null;

/** Best-effort report; never throws and never blocks the request. */
export function captureRouteError(err: unknown, ctx: ServerContext): void {
  // Always log to the server console so Vercel's function logs still
  // capture it even when Sentry is off.
  const tag = `[error]${ctx.endpoint}${ctx.studentId ? ` student=${ctx.studentId.slice(0, 8)}` : ""}`;
  console.error(tag, err, ctx.meta);

  if (!serverDsn) return;

  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack.split("\n").slice(0, 30) : [];
  const eventId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(16).slice(2);

  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: new Date().toISOString(),
    sdk: { name: "nycu-physics-tutor", version: "0.0.1" },
  });
  const itemHeader = JSON.stringify({ type: "event" });
  const crumbs = breadcrumbStore.getStore() ?? [];
  const payload = JSON.stringify({
    event_id: eventId,
    platform: "node",
    environment: ENV,
    level: "error",
    logger: "api",
    message: { formatted: message },
    exception: {
      values: [{
        type: err instanceof Error ? err.name : "Error",
        value: message,
        stacktrace: { frames: stack.map((line) => ({ filename: "trace", function: line.trim() })) },
      }],
    },
    breadcrumbs: { values: crumbs },
    tags: { endpoint: ctx.endpoint },
    extra: ctx.meta,
    user: ctx.studentId ? { id: ctx.studentId } : undefined,
  });

  const body = `${envelopeHeader}\n${itemHeader}\n${payload}`;
  // Fire-and-forget. Wrap in setTimeout(0) to detach from the request
  // event loop so a hung Sentry endpoint can't slow our response.
  setTimeout(() => {
    void fetch(serverDsn.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth":
          `Sentry sentry_version=7, sentry_client=nycu-physics-tutor/0.0.1, sentry_key=${serverDsn.publicKey}`,
      },
      body,
    }).catch(() => {
      // Swallow — never let telemetry break user-facing flows.
    });
  }, 0);
}
