/**
 * Convert single-line inline $$...$$ to $...$.
 *
 * remark-math 6 doesn't reliably parse $$...$$ when it appears in flowing
 * text — especially on a line that *starts* with $$ but has trailing text
 * (e.g. "$$y(t)=...$$其中..."), where the second $$ gets misread as the
 * start of block math. Models love emitting two adjacent $$...$$ blocks
 * separated only by a newline, which trips this case.
 *
 * Single-$ inline math handles all those cases robustly, and visually the
 * difference (KaTeX's display vs. text style) is small enough for our
 * hint/quiz/exam content. True multi-line display math ($$...\n...$$ on
 * its own with blank lines around) is left alone.
 */
function normalizeMathDelimiters(text: string): string {
  if (!text || !text.includes("$$")) return text;
  return text.replace(/\$\$([^$\n]+?)\$\$/g, (_match, content) => "$" + content + "$");
}

/**
 * Reverses JSON.parse's eager interpretation of LaTeX backslash commands.
 *
 * When generateObject() runs, Gemini occasionally emits a JSON string like
 *   "S = \frac{1}{2}at^2"
 * with a single backslash. The JSON spec treats \f as a form-feed escape, so
 * JSON.parse turns "\frac" into "<U+000C>rac". KaTeX then sees "rac{1}{2}"
 * and renders a red error.
 *
 * Reverses four JSON escapes that collide with LaTeX command prefixes:
 *   \f → \frac, \floor, ...
 *   \t → \theta, \tan, \times, ...
 *   \r → \rho, \rightarrow, ...
 *   \b → \beta, \bar, \binom, ...
 *
 * Deliberately does NOT restore \n: legitimate newlines inside multi-line
 * $$...$$ display math are extremely common (one per row in aligned envs)
 * and converting them to literal "\n" text breaks rendering. The cost is
 * \nabla / \neq / \nu won't auto-recover from a single-backslash emit;
 * models need to use \\nabla in their JSON, which the prompts already
 * teach via the \\propto example.
 */
export function restoreLatexEscapes(text: string): string {
  if (!text) return text;
  const normalized = normalizeMathDelimiters(text);
  if (!normalized.includes("$")) return normalized;

  return normalized.replace(/\$\$[\s\S]+?\$\$|\$[^\n$]+?\$/g, (block) =>
    block
      .replace(/\f(?=[a-z])/g, "\\f")
      .replace(/[\b](?=[a-z])/g, "\\b")
      .replace(/\t(?=[a-z])/g, "\\t")
      .replace(/\r(?=[a-z])/g, "\\r"),
  );
}

/**
 * Strip Gemini's accidental English meta-commentary from the tail of a
 * chat response.
 *
 * Symptom: the model writes a perfectly good Chinese answer, then tacks
 * on a paragraph like "The user asked for an explanation… Now I need to
 * silently update the student model…" — its own internal planning,
 * leaked into the visible reply. The system prompt already forbids it,
 * but Gemini Flash occasionally forgets, so this is the belt-and-braces
 * removal on the render side.
 *
 * Heuristic: walk paragraphs from the BOTTOM up. A paragraph is "meta"
 * when it contains no Chinese characters AND looks like English prose
 * (≥3 ASCII words). As soon as we hit a paragraph that has Chinese in
 * it — i.e. the real answer — we stop. That way an answer that
 * legitimately ends in a citation like "(Newton, 1687)" survives, while
 * a 4-paragraph English thought-dump at the tail gets cleanly trimmed.
 */
export function stripMetaCommentary(text: string): string {
  if (!text) return text;
  // Bail out fast when the whole answer is English. The legitimate case
  // is a student asking "what is X" about an English physics term, or
  // requesting a translation — wiping the entire reply because no
  // paragraph happens to contain Chinese is much worse than letting
  // through the rare meta leak we'd otherwise catch.
  if (!/[一-鿿]/.test(text)) return text;

  const paragraphs = text.split(/\n{2,}/);
  let dropFrom = paragraphs.length;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i].trim();
    if (!p) {
      dropFrom = i;
      continue;
    }
    const hasChinese = /[一-鿿]/.test(p);
    if (hasChinese) break;
    const asciiWords = (p.match(/[A-Za-z]+/g) ?? []).length;
    if (asciiWords < 3) break;
    dropFrom = i;
  }
  if (dropFrom === paragraphs.length) return text;
  return paragraphs.slice(0, dropFrom).join("\n\n").trimEnd();
}

/** Walk an object/array and apply restoreLatexEscapes to every string value.
 *  Use right after generateObject() to fix LaTeX in all text fields. */
export function restoreLatexInObject<T>(value: T): T {
  if (typeof value === "string") return restoreLatexEscapes(value) as T;
  if (Array.isArray(value)) return value.map((v) => restoreLatexInObject(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = restoreLatexInObject(v);
    }
    return out as T;
  }
  return value;
}
