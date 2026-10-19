import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared fixture for every smoke spec.
 *
 * 1. LLM route guard — every API route that calls Gemini is aborted at the
 *    network layer. An accidental click on 開始測驗 / 開始口試 / a chat send
 *    therefore fails the request immediately instead of spending quota.
 *    (Teaching mode fires one such call on purpose when a page loads; the
 *    spec asserts that it was intercepted rather than letting it through.)
 *
 * 2. Console / page-error capture — any `console.error` or uncaught
 *    exception fails the test in teardown. The only tolerated console
 *    error is Chromium's own "Failed to load resource" line for a request
 *    the guard itself aborted.
 */

export const LLM_ROUTE_RE =
  /\/api\/(chat|quiz|exam|oral-exam|preview|hint|notes-quiz|concept-compare|regen-question|study-plan|attempt-analysis|export-report|reflection)(\/|\?|$)/;

type Fixtures = {
  /** URLs of requests the LLM guard aborted during this test. */
  guardedRequests: string[];
};

// Playwright names the fixture callback `use`; it is renamed to `provide`
// here so eslint's react-hooks/rules-of-hooks doesn't mistake it for React's
// `use()` hook.
export const test = base.extend<Fixtures>({
  guardedRequests: async ({}, provide) => {
    await provide([]);
  },

  page: async ({ page, guardedRequests }, provide, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    await page.route(LLM_ROUTE_RE, (route) => {
      guardedRequests.push(route.request().url());
      void route.abort("blockedbyclient");
    });

    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const url = msg.location().url;
      if (LLM_ROUTE_RE.test(url) && /Failed to load resource/.test(msg.text())) return;
      consoleErrors.push(`${msg.text()} @ ${url || "(no location)"}`);
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.stack ?? err.message);
    });

    await provide(page);

    // Only enforce on tests that otherwise passed so the original failure
    // message isn't masked by a console-error report.
    if (testInfo.status === testInfo.expectedStatus) {
      expect(pageErrors, "uncaught page errors").toEqual([]);
      expect(consoleErrors, "console.error output").toEqual([]);
    }
  },
});

export { expect };

/* ─── Navigation helpers (state-based routing: no URL per mode) ─── */

export const HOME_HEADING = "歡迎使用普通物理 AI 助教";

export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
}

/** Click the home-screen card whose text contains `title`. */
export async function openMode(page: Page, title: string): Promise<void> {
  await page.locator("button", { hasText: title }).first().click();
}

export async function expectHome(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
}
