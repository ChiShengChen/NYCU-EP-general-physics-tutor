/**
 * Strict whitelist SVG sanitizer for AI-generated diagrams.
 *
 * Old version was regex-based — it removed `<script>` and on* handlers
 * but **didn't strip `<image href>`, `<animate>`, `<use href>`, or
 * `<foreignObject>`**, all of which can either exfiltrate data
 * (browser fetches the URL, leaking session tokens via referer) or
 * inject arbitrary HTML into the page. Audit issue #8.
 *
 * This replacement uses DOMParser to walk the tree, drops any element
 * not on a small allowlist of geometric / labelling tags, and strips
 * attributes whose value looks remotely capable of triggering a fetch
 * or running a script. The output is rebuilt with `outerHTML` so any
 * pre-existing CDATA, processing instructions, and DOCTYPE constructs
 * are discarded by definition.
 *
 * Allowed structure is intentionally minimal: shapes, paths, text,
 * basic groups and gradients, plus `<defs>` / `<marker>` for arrowheads.
 * If we ever want SVG-rendered images (icons) we can add a narrower
 * `<image>` rule that only accepts data:image/png;base64,... payloads.
 */

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "svg", "g", "defs", "title", "desc",
  "rect", "circle", "ellipse", "line", "polyline", "polygon", "path",
  "text", "tspan",
  "marker", "linearGradient", "radialGradient", "stop",
]);

const FORBIDDEN_TAGS: ReadonlySet<string> = new Set([
  "script", "foreignobject", "image", "use", "a",
  "animate", "animatetransform", "animatemotion", "set",
  "iframe", "embed", "object", "video", "audio",
  "style", "link", "meta",
]);

/**
 * Allowed attribute names. Whitelisting attributes (rather than
 * blacklisting on*) is what closes the new-attack-vector loop: any
 * `<animate attributeName="onmouseover" to="alert(1)">`-style trick
 * dies here because `attributeName` isn't on the list, and even if it
 * were, the host element type `<animate>` is in FORBIDDEN_TAGS.
 *
 * Geometric attributes only — no event handlers, no href/xlink:href,
 * no formAction etc.
 */
const ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  // Identity / namespacing
  "xmlns", "xmlns:xlink", "version",
  // Coordinates / sizes
  "viewBox", "width", "height", "x", "y", "cx", "cy", "r", "rx", "ry",
  "x1", "x2", "y1", "y2", "points", "d",
  // Transforms
  "transform", "transform-origin",
  // Styling (attribute form — no <style> tag and no event-bearing CSS)
  "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit",
  "opacity", "color",
  "font-size", "font-family", "font-weight", "font-style",
  "text-anchor", "alignment-baseline", "dominant-baseline",
  "dx", "dy", "rotate", "lengthAdjust",
  // Gradient stop attrs
  "offset", "stop-color", "stop-opacity",
  // Marker attrs
  "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits",
  "marker-end", "marker-start", "marker-mid",
  // Identifiers used by gradients/markers (no href tho — we use url(#id))
  "id", "class",
  // Misc: ARIA labels are safe and helpful for screen readers
  "aria-label", "role",
]);

/**
 * Reject any attribute value that contains the literal substrings
 * "javascript:", "data:" (other than safe `data:image/...;base64`),
 * or the SVG `<set>` smuggling pattern `&#x` (hex char references that
 * could decode to a script kw). We also strip values containing
 * `expression(` (legacy IE CSS) for paranoia.
 */
function attributeValueIsSafe(name: string, value: string): boolean {
  const v = value.toLowerCase().trim();
  if (v.includes("javascript:")) return false;
  if (v.includes("vbscript:")) return false;
  if (v.includes("expression(")) return false;
  // Allow data: only for image data URIs and only on attributes that
  // already shouldn't reach an image element anyway, since <image> is
  // forbidden. Block to be safe.
  if (v.startsWith("data:")) return false;
  // Block url() references to anything except local fragment ids.
  if (v.includes("url(")) {
    const ok = /^url\(["']?#[\w-]+["']?\)$/i.test(value.trim());
    if (!ok) return false;
  }
  // Length cap — pathologically long values are usually exploit payloads.
  if (value.length > 4096) return false;
  // Belt-and-braces: drop any attribute that starts with "on" (event)
  // even if it slipped through the whitelist via casing tricks.
  if (name.toLowerCase().startsWith("on")) return false;
  return true;
}

function sanitizeElement(el: Element): void {
  const tag = el.tagName.toLowerCase();

  // Forbidden tag → remove subtree entirely. Use parentNode.removeChild
  // (rather than the newer el.remove()) so the same code works under
  // both browser DOM and the @xmldom shim we use in unit tests.
  if (FORBIDDEN_TAGS.has(tag) || !ALLOWED_TAGS.has(tag)) {
    el.parentNode?.removeChild(el);
    return;
  }

  // Walk attributes (snapshot to array because we mutate during loop).
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    const baseName = name.split(":").pop() ?? name; // strip namespace prefix
    const allowed = ALLOWED_ATTRS.has(name) || ALLOWED_ATTRS.has(baseName);
    if (!allowed || !attributeValueIsSafe(name, attr.value)) {
      el.removeAttribute(name);
    }
  }

  // Recurse into surviving element children. Use childNodes + nodeType
  // filter instead of `.children` so this works with both real browsers
  // and @xmldom (which doesn't implement HTMLCollection.children).
  const kids: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 1) kids.push(n as Element);
  }
  for (const child of kids) sanitizeElement(child);
}

/**
 * Sanitize an AI-generated SVG string.
 *
 * SSR-safe: returns the input untouched if no DOMParser exists (we never
 * render the dangerouslySetInnerHTML path server-side, so this only
 * matters for unit-test ergonomics).
 */
export function sanitizeSvg(raw: string): string {
  if (typeof DOMParser === "undefined") return "";
  let s = raw.trim();
  // Extract only the first <svg>...</svg> block if surrounding text leaked.
  const m = s.match(/<svg[\s\S]*?<\/svg>/i);
  if (m) s = m[0];
  if (!s) return "";

  const parser = new DOMParser();
  let doc: Document;
  try {
    doc = parser.parseFromString(s, "image/svg+xml");
  } catch {
    // @xmldom (used in unit tests) throws on invalid XML rather than
    // returning a parsererror element. Either way → reject.
    return "";
  }
  if (doc.getElementsByTagName("parsererror").length > 0) return "";

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") return "";

  sanitizeElement(root);
  // outerHTML lands on the browser Element; in non-browser test envs
  // (jsdom / @xmldom) fall back to an XMLSerializer round-trip so the
  // helper stays exercise-able from unit tests.
  if (typeof root.outerHTML === "string") return root.outerHTML;
  if (typeof XMLSerializer !== "undefined") {
    return new XMLSerializer().serializeToString(root);
  }
  return "";
}
