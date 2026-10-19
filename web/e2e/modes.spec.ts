import { test, expect, gotoHome, openMode, LLM_ROUTE_RE } from "./fixtures";

/**
 * Each non-LLM screen opens and shows its header. Nothing here submits a
 * form or presses a 開始… button that would call Gemini; the route guard
 * in fixtures.ts backs that up at the network layer.
 */

test.describe("modes", () => {
  test("教學模式 → chapter picker → Ch05 page with slide + nav", async ({ page, guardedRequests }) => {
    await gotoHome(page);
    await openMode(page, "教學模式");
    await expect(page.getByRole("heading", { level: 1, name: "教學模式 — 選擇章節" })).toBeVisible();

    const ch05 = page.locator("button", { hasText: "Ch05" }).first();
    await expect(ch05).toBeVisible();
    await ch05.click();

    await expect(page.getByRole("heading", { level: 1, name: /^Ch05$/ })).toBeVisible();
    await expect(page.getByText(/Page 1 \/ \d+/)).toBeVisible();

    // Slide image must actually decode — a broken Supabase storage URL
    // swaps the <img> for a 此頁無投影片 placeholder.
    const slide = page.locator('img[alt="Ch05 Page 1"]');
    await expect(slide).toBeVisible();
    await expect
      .poll(() => slide.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(page.getByText("此頁無投影片")).toHaveCount(0);

    // Page nav: prev disabled on page 1, next enabled, select lists pages.
    await expect(page.locator("button", { hasText: "上一頁" })).toBeDisabled();
    const next = page.locator("button", { hasText: "下一頁" });
    await expect(next).toBeEnabled();
    await expect(page.locator("select option")).not.toHaveCount(0);

    await next.click();
    await expect(page.getByText(/Page 2 \/ \d+/)).toBeVisible();
    await expect(page.locator('img[alt="Ch05 Page 2"]')).toBeVisible();

    // Teaching mode auto-requests an explanation per page; the guard must
    // have swallowed it (one per page visited) rather than let it reach
    // Gemini.
    await expect
      .poll(() => guardedRequests.filter((u) => /\/api\/chat/.test(u)).length)
      .toBeGreaterThanOrEqual(1);
    expect(guardedRequests.every((u) => LLM_ROUTE_RE.test(u))).toBe(true);
  });

  test("自動測驗 selection screen", async ({ page }) => {
    await gotoHome(page);
    await openMode(page, "自動測驗");
    await expect(page.getByRole("heading", { level: 1, name: "自動測驗" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "選擇測驗範圍" })).toBeVisible();
  });

  test("考試模擬 selection screen", async ({ page }) => {
    await gotoHome(page);
    await openMode(page, "考試模擬");
    await expect(page.getByRole("heading", { level: 1, name: "考試模擬" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "考試模擬模式" })).toBeVisible();
    // The start button exists but is never clicked.
    await expect(page.locator("button", { hasText: /開始(期中|期末)考試/ })).toBeVisible();
  });

  test("口試模擬 selection screen with chapter chips", async ({ page, guardedRequests }) => {
    await gotoHome(page);
    await openMode(page, "口試模擬");
    await expect(page.getByRole("heading", { level: 1, name: "口試模擬" })).toBeVisible();

    const start = page.locator("button", { hasText: "開始口試" });
    await expect(start).toBeVisible();
    await expect(start).toBeDisabled();

    // Picking chapters is local state only.
    const ch05 = page.locator("button", { hasText: /^Ch05$/ });
    await expect(ch05).toBeVisible();
    await ch05.click();
    await page.locator("button", { hasText: /^Ch08$/ }).click();
    await expect(page.getByText(/已選\s*2/)).toBeVisible();
    await expect(page.getByText("Ch05 + Ch08")).toBeVisible();
    await expect(start).toBeEnabled();

    expect(guardedRequests.filter((u) => /oral-exam/.test(u))).toEqual([]);
  });

  test("費曼 picker", async ({ page }) => {
    await gotoHome(page);
    await openMode(page, "費曼");
    await expect(page.getByRole("heading", { level: 1, name: "教 AI — 費曼學習法" })).toBeVisible();
    await expect(page.getByPlaceholder(/動量守恆/)).toBeVisible();
  });

  test("章節預習 picker", async ({ page, guardedRequests }) => {
    await gotoHome(page);
    await openMode(page, "章節預習");
    await expect(page.getByRole("heading", { level: 1, name: "章節預習 — 選擇章節" })).toBeVisible();
    await expect.poll(() => page.locator("button", { hasText: /^Ch\d{2}/ }).count()).toBeGreaterThanOrEqual(30);
    expect(guardedRequests.filter((u) => /\/api\/preview/.test(u))).toEqual([]);
  });

  test("自由問答 input visible", async ({ page, guardedRequests }) => {
    await gotoHome(page);
    await openMode(page, "自由問答");
    await expect(page.getByRole("heading", { level: 1, name: "普通物理 AI 助教" })).toBeVisible();
    await expect(page.getByPlaceholder(/輸入問題/)).toBeVisible();
    expect(guardedRequests.filter((u) => /\/api\/chat/.test(u))).toEqual([]);
  });

  test("概念圖譜 renders chapter nodes", async ({ page }) => {
    await gotoHome(page);
    await openMode(page, "概念圖譜");
    await expect(page.getByRole("heading", { level: 1, name: "概念知識圖譜" })).toBeVisible();
    // Each overview node is a <g> with a Ch## sub-label.
    const nodeLabels = page.locator("svg text", { hasText: /^Ch\d{2}$/ });
    await expect.poll(() => nodeLabels.count()).toBeGreaterThanOrEqual(30);
  });

  for (const title of ["錯題本", "測驗紀錄", "學習儀表板"]) {
    test(`${title} opens without error`, async ({ page }) => {
      await gotoHome(page);
      await openMode(page, title);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    });
  }
});
