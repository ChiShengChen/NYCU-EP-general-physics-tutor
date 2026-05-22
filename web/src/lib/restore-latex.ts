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
