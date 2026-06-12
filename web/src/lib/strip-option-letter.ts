/**
 * Strip a leading "A.", "B)", "(C)", "D、" — etc. from an option string.
 *
 * Gemini sometimes generates choices like "A. 兩種情況下..." even though
 * we render the letter prefix ourselves, which produces a double "A. A."
 * in the UI. Old attempt rows already exist with the prefix baked in, so
 * we strip on render rather than rewriting the prompt and re-grading
 * every historical question.
 *
 * Conservative: only strips when the letter at the front actually matches
 * the option's positional letter (A for index 0, B for 1, …). That way a
 * legitimate option like "A 為真，B 為假" — where "A" is content, not a
 * prefix — survives untouched.
 */
// Whitespace after the punctuation is optional: Chinese-style
// punctuation (、:：。．) is commonly used without a trailing space, and
// the function's positional-letter check still keeps the strip narrow
// enough that legitimate content like "A 為真" doesn't get mangled.
const PREFIX_RE = /^\s*[(（]?([A-Da-d])[)）。．.、:：]\s*/;

export function stripOptionLetter(option: string, index: number): string {
  if (!option) return option;
  const m = option.match(PREFIX_RE);
  if (!m) return option;
  const expected = String.fromCharCode(65 + index).toLowerCase();
  if (m[1].toLowerCase() !== expected) return option;
  return option.slice(m[0].length);
}
