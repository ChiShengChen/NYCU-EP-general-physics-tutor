import { test, expect, gotoHome, expectHome } from "./fixtures";

test.describe("home", () => {
  test("renders every mode card", async ({ page }) => {
    await gotoHome(page);

    // 4 + 4 + 4 + 5 grid cards, 3 banners, daily-review banner, header
    // controls — well over 20 buttons. A missing row would drop below.
    const buttons = page.locator("button");
    await expect.poll(() => buttons.count()).toBeGreaterThanOrEqual(20);

    for (const title of [
      "章節預習",
      "教學模式",
      "自由問答",
      "自動測驗",
      "教 AI（費曼法）",
      "考試模擬",
      "概念圖譜",
      "AI 學習計畫",
      "互動模擬器",
      "從我的筆記出題",
      "口試模擬",
      "學習儀表板",
      "測驗紀錄",
      "錯題本",
      "對話歷史",
    ]) {
      await expect(page.locator("button", { hasText: title }).first(), title).toBeVisible();
    }

    // The oral-exam banner carries its own CTA label.
    const oral = page.locator("button", { hasText: "口試模擬" }).first();
    await expect(oral).toContainText("開始口試");
  });

  test("keyboard 4 opens 自動測驗 and Escape returns home", async ({ page }) => {
    await gotoHome(page);

    await page.keyboard.press("4");
    await expect(page.getByRole("heading", { level: 1, name: "自動測驗" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "選擇測驗範圍" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expectHome(page);
  });
});
