/**
 * Reverses JSON.parse's eager interpretation of LaTeX backslash commands.
 *
 * When generateObject() runs, Gemini occasionally emits a JSON string like
 *   "S = \frac{1}{2}at^2"
 * with a single backslash. The JSON spec treats \f as a form-feed escape, so
 * JSON.parse turns "\frac" into "<U+000C>rac". KaTeX then sees "rac{1}{2}"
 * and renders a red error.
 *
 * This helper reverses that for the five JSON escape sequences that collide
 * with LaTeX command prefixes:
 *   \f → \frac, \floor, ...
 *   \n → \nabla, \neq, \nu, ...
 *   \t → \theta, \tan, \times, ...
 *   \r → \rho, \rightarrow, ...
 *   \b → \beta, \bar, \binom, ...
 *
 * Only fires inside $...$ / $$...$$ math blocks, and only when the control
 * char is immediately followed by a lowercase letter (i.e. looks like the
 * start of a LaTeX command) — so legitimate whitespace in surrounding
 * markdown is never touched.
 */
export function restoreLatexEscapes(text: string): string {
  if (!text || !text.includes("$")) return text;

  return text.replace(/\$\$[\s\S]+?\$\$|\$[^\n$]+?\$/g, (block) =>
    block
      .replace(/\f(?=[a-z])/g, "\\f")
      .replace(/[\b](?=[a-z])/g, "\\b")
      .replace(/\t(?=[a-z])/g, "\\t")
      .replace(/\r(?=[a-z])/g, "\\r")
      .replace(/\n(?=[a-z])/g, "\\n"),
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
