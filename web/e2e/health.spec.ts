import { test, expect } from "./fixtures";

const STATUSES = ["ok", "degraded", "down"];

test.describe("health", () => {
  test("/health-check page shows the status list", async ({ page }) => {
    await page.goto("/health-check");
    await expect(page.getByRole("heading", { level: 1, name: /系統健檢/ })).toBeVisible();

    // Overall badge is one of the three states (never the fetch-failed card).
    await expect(page.getByText(/🟢 全部正常|🟡 部分降級|🔴 服務異常/)).toBeVisible();
    await expect(page.getByText("無法取得 health check")).toHaveCount(0);

    // Per-check rows: name in monospace + 必要 / 選用 tag.
    const rows = page.locator("div", { has: page.getByText(/^(必要|選用)$/) }).locator("span.font-mono");
    await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator("span.font-mono", { hasText: /supabase/i }).first()).toBeVisible();
  });

  test("/api/health-check returns a well-formed payload", async ({ request }) => {
    const res = await request.get("/api/health-check");
    expect([200, 503], `unexpected status ${res.status()}`).toContain(res.status());
    expect(res.headers()["content-type"]).toMatch(/application\/json/);

    const body = (await res.json()) as {
      status?: string;
      checkedAt?: string;
      checks?: Record<string, { ok?: boolean; critical?: boolean; status?: string }>;
    };
    expect(STATUSES).toContain(body.status);
    expect(typeof body.checkedAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.checkedAt!))).toBe(false);

    expect(body.checks && typeof body.checks).toBe("object");
    const names = Object.keys(body.checks!);
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) {
      const c = body.checks![name];
      expect(typeof c.ok, `${name}.ok`).toBe("boolean");
      expect(typeof c.critical, `${name}.critical`).toBe("boolean");
      expect(STATUSES, `${name}.status`).toContain(c.status);
    }

    // 503 must coincide with a failed critical check, and vice versa.
    const criticalFailed = names.some((n) => body.checks![n].critical && !body.checks![n].ok);
    expect(res.status() === 503).toBe(criticalFailed);
  });
});
