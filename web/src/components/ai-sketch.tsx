"use client";

/* AI-generated SVG sketches embedded in chat messages.
 * The model emits <svg>...</svg> via the `sketchVisualUnderstanding` tool;
 * we sanitize and inline it so students can compare with their original image.
 *
 * Sanitisation is delegated to `@/lib/sanitize-svg` which is a strict
 * DOM-walking whitelist — much stronger than the regex stripper that
 * lived here before and that audit issue #8 flagged for missing
 * `<image href>` / `<animate>` / `<use>` / `<foreignObject>` vectors. */

import { sanitizeSvg } from "@/lib/sanitize-svg";

interface AiSketchProps {
  title: string;
  svg: string;
  notes?: string;
  /** Hint: rendered inside an assistant bubble. Pass true on user side if
   *  you ever need flipped colours; default = assistant. */
  variant?: "assistant";
}

export function AiSketch({ title, svg, notes }: AiSketchProps) {
  const safe = sanitizeSvg(svg);
  return (
    <div className="my-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 mb-1.5 text-amber-800 dark:text-amber-200">
        <span>🎨</span>
        <span className="font-medium">{title}</span>
        <span className="ml-auto text-[10px] text-amber-700 dark:text-amber-300">請對照原圖確認</span>
      </div>
      {/* Force a white background for the AI sketch regardless of theme.
       *  Gemini-generated SVGs assume dark strokes on a light page; on a
       *  slate-900 surface those strokes would be invisible. */}
      <div
        className="bg-white text-slate-800 rounded-lg border border-amber-100 dark:border-amber-900/40 px-2 py-2 [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:mx-auto"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
      {notes && (
        <p className="mt-1.5 text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">{notes}</p>
      )}
    </div>
  );
}
