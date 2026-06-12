import { describe, expect, it } from "vitest";
import { DOMParser as XmlDomParser, XMLSerializer as XmlDomSerializer } from "@xmldom/xmldom";

// sanitize-svg uses DOMParser + (in non-browser envs) XMLSerializer.
// Stub both via @xmldom before importing the module under test so its
// `typeof DOMParser === "undefined"` check passes.
// @ts-expect-error: stubbing browser globals on the test runtime
globalThis.DOMParser = XmlDomParser;
// @ts-expect-error: stubbing browser globals on the test runtime
globalThis.XMLSerializer = XmlDomSerializer;

import { sanitizeSvg } from "./sanitize-svg";

describe("sanitizeSvg", () => {
  it("returns empty string for non-SVG input", () => {
    expect(sanitizeSvg("not an svg")).toBe("");
    expect(sanitizeSvg("")).toBe("");
  });

  it("preserves a basic SVG with allowed elements", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="0" y="0" width="100" height="100" fill="white"/>
      <text x="10" y="20">Hello</text>
    </svg>`;
    const out = sanitizeSvg(src);
    expect(out).toContain("<rect");
    expect(out).toContain("<text");
    expect(out).toContain("Hello");
  });

  it("removes <script> entirely", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>`;
    const out = sanitizeSvg(src);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/alert/);
    expect(out).toContain("<circle");
  });

  it("removes <image> tags (potential SSRF via href)", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><image href="http://attacker.com/x"/></svg>`;
    const out = sanitizeSvg(src);
    expect(out).not.toMatch(/<image/i);
  });

  it("removes <animate> tags (timing-based exfil vector)", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="x" from="0" to="10"/></svg>`;
    const out = sanitizeSvg(src);
    expect(out).not.toMatch(/<animate/i);
  });

  it("removes <foreignObject> (arbitrary HTML host)", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>`;
    const out = sanitizeSvg(src);
    expect(out).not.toMatch(/<foreignObject/i);
  });

  it("strips on* event-handler attributes", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><circle onclick="alert(1)" r="5"/></svg>`;
    const out = sanitizeSvg(src);
    expect(out).toContain("<circle");
    expect(out).not.toMatch(/onclick/i);
  });

  it("rejects javascript: URLs in fill values", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><circle fill="javascript:alert(1)" r="5"/></svg>`;
    const out = sanitizeSvg(src);
    expect(out).not.toMatch(/javascript:/i);
  });
});
