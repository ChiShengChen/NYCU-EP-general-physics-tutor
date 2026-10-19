import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke suite. Runs against an already-deployed URL (Vercel preview /
 * production) or a local `next dev` — nothing here starts a server.
 *
 *   E2E_BASE_URL=https://nycu-ep-general-physics-tutor.vercel.app npm run e2e
 *
 * Every spec goes through `./fixtures` which aborts all LLM-backed API
 * routes, so the suite can run on every deploy without burning Gemini
 * quota. See fixtures.ts for the list.
 */

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  // Keep artifacts out of e2e/ so the spec folder stays clean; both paths
  // are gitignored at the repo root.
  outputDir: "../test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "zh-TW",
    colorScheme: "light",
    viewport: { width: 1400, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } },
    },
  ],
});
