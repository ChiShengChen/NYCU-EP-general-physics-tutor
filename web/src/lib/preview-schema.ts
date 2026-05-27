import { z } from "zod";

export const PreviewConceptSchema = z.object({
  title: z.string().describe("概念名稱（繁體中文，可帶英文，例如：動量守恆 Conservation of Momentum）"),
  summary: z.string().describe("1–2 句說明這個概念是什麼，繁體中文"),
  formula: z.string().describe("核心公式 LaTeX，**必須用 $$...$$ 包起來**（例如 $$\\\\vec{F} = m\\\\vec{a}$$）。若該概念本身沒有公式（如「自由體圖」），回傳空字串"),
  keyInsight: z.string().describe("一句重點提醒、常見迷思或物理直覺，繁體中文"),
  referencePage: z.number().describe("這個概念在該章講義第幾頁出現（從 1 開始的整數；若無法判定請填 1）"),
});

export const PreviewSchema = z.object({
  concepts: z.array(PreviewConceptSchema).min(5).max(7),
});

export type PreviewConcept = z.infer<typeof PreviewConceptSchema>;
export type Preview = z.infer<typeof PreviewSchema>;
