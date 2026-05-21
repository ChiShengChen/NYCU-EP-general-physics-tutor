"use client";

/* AI-generated SVG sketches embedded in chat messages.
 * The model emits <svg>...</svg> via the `sketchVisualUnderstanding` tool;
 * we sanitize and inline it so students can compare with their original image. */

/** Strip XSS vectors from model-generated SVG. Allowed: standard shape /
 *  text / group tags. Stripped: <script>, on* event handlers, javascript:
 *  URIs, external href that aren't simple #fragments. */
function sanitizeSvg(raw: string): string {
  let s = raw.trim();
  // Keep only the <svg>...</svg> block if extra text leaked in.
  const m = s.match(/<svg[\s\S]*?<\/svg>/i);
  if (m) s = m[0];

  // Remove <script>...</script> entirely.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Remove on*="..." event handlers.
  s = s.replace(/\s+on[a-z]+\s*=\s*"(?:\\.|[^"\\])*"/gi, "");
  s = s.replace(/\s+on[a-z]+\s*=\s*'(?:\\.|[^'\\])*'/gi, "");
  // Neutralise javascript: URIs.
  s = s.replace(/(href|xlink:href)\s*=\s*"(?:\s*javascript:)[^"]*"/gi, '$1="#"');
  s = s.replace(/(href|xlink:href)\s*=\s*'(?:\s*javascript:)[^']*'/gi, "$1='#'");
  // Remove any <foreignObject> (can host arbitrary HTML).
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  return s;
}

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
    <div className="my-2 rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 mb-1.5 text-amber-800">
        <span>🎨</span>
        <span className="font-medium">{title}</span>
        <span className="ml-auto text-[10px] text-amber-700">請對照原圖確認</span>
      </div>
      <div
        className="bg-white rounded-lg border border-amber-100 px-2 py-2 [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:mx-auto"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
      {notes && (
        <p className="mt-1.5 text-[11px] text-amber-800 leading-relaxed">{notes}</p>
      )}
    </div>
  );
}
