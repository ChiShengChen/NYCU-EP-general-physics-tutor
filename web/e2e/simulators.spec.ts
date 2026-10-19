import { test, expect, gotoHome, openMode } from "./fixtures";

/**
 * Gallery card title (src/lib/sim-mappings.ts) → in-sim <h1> (the `title`
 * prop each sim passes to SimChrome). Keep in sync when a sim is added.
 */
const SIMS: Array<{ card: string; heading: string }> = [
  { card: "自由落體", heading: "自由落體模擬" },
  { card: "拋體運動", heading: "拋體運動模擬" },
  { card: "1D 碰撞", heading: "1D 碰撞模擬" },
  { card: "彈簧與簡諧運動", heading: "彈簧 / 簡諧運動模擬" },
  { card: "電場線", heading: "電場線（向量場）模擬" },
  { card: "RC 電路", heading: "RC 電路模擬" },
  { card: "透鏡成像", heading: "透鏡成像模擬" },
  { card: "球面鏡成像", heading: "球面鏡成像模擬" },
  { card: "折射與全反射", heading: "折射與全反射模擬" },
];

/** Scan every SVG attribute on the page for a non-finite number. */
async function findBadSvgAttributes(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll("svg, svg *").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (/\bNaN\b|Infinity/.test(attr.value)) {
          bad.push(`<${el.tagName.toLowerCase()} ${attr.name}="${attr.value.slice(0, 80)}">`);
        }
      }
    });
    return bad;
  });
}

/** Width of the widest <svg> — the sim canvas is far larger than icon SVGs. */
async function widestSvgWidth(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(0, ...Array.from(document.querySelectorAll("svg")).map((s) => s.getBoundingClientRect().width)),
  );
}

test.describe("simulators", () => {
  test("gallery shows 9 cards", async ({ page }) => {
    await gotoHome(page);
    await openMode(page, "互動模擬器");
    await expect(page.getByRole("heading", { level: 1, name: "互動模擬器" })).toBeVisible();

    const cards = page.locator("button:has(h3)");
    await expect(cards).toHaveCount(SIMS.length);
    for (const { card } of SIMS) {
      await expect(cards.filter({ hasText: card }), card).toHaveCount(1);
    }
  });

  for (const { card, heading } of SIMS) {
    test(`${card}: canvas renders, slider drives readouts`, async ({ page }) => {
      await gotoHome(page);
      await openMode(page, "互動模擬器");
      await page.locator("button:has(h3)", { hasText: card }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();

      // Canvas SVG exists (icon SVGs are ~20px; the canvas is hundreds).
      await expect.poll(() => widestSvgWidth(page)).toBeGreaterThan(200);
      expect(await findBadSvgAttributes(page), "non-finite SVG attribute").toEqual([]);

      // Readouts panel + first enabled slider.
      const readouts = page.locator("section", { has: page.getByRole("heading", { name: "即時讀數" }) });
      await expect(readouts).toBeVisible();
      const slider = page.locator("input[type=range]:enabled").first();
      await expect(slider).toBeVisible();

      const sliderRow = slider.locator("xpath=ancestor::label[1]");
      const beforeDisplay = await sliderRow.innerText();
      const beforeReadouts = await readouts.innerText();

      // Drive the slider from the keyboard so React's onChange fires
      // naturally; jump to the opposite end so the change is large.
      const { value, min, max } = await slider.evaluate((el) => {
        const r = el as HTMLInputElement;
        return { value: Number(r.value), min: Number(r.min), max: Number(r.max) };
      });
      await slider.focus();
      await page.keyboard.press(value - min < max - value ? "End" : "Home");

      await expect.poll(() => sliderRow.innerText()).not.toBe(beforeDisplay);
      await expect.poll(() => readouts.innerText()).not.toBe(beforeReadouts);

      // Still finite after the parameter change.
      expect(await findBadSvgAttributes(page), "non-finite SVG attribute after slider change").toEqual([]);
    });
  }
});
