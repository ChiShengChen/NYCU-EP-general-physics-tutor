"""
Aggregate formula + law nodes from all Ch{N}.concepts.json into a single
flat graph for the cross-chapter formula network view.

Output: web/public/concepts/all-formulas.json
    {
      "nodes": [
        {
          "id": "ch04:newtons-2nd-law",     # prefixed with chapter
          "chapter": 4,
          "category": "mechanics" | "waves_fluid" | "thermo" | "em" | "optics",
          "label", "kind", "summary", "latex", "pages": [...]
        }
      ],
      "edges": [
        { "from", "to", "reason" }          # intra-chapter only, formula↔formula
      ]
    }

Cross-chapter edges are intentionally left empty in Stage 1 — only edges that
appear between two formula/law nodes in the same chapter's source JSON are
kept. The user prefers fewer but accurate edges over speculative ones.

Usage:
    python scripts/build_formula_graph.py
"""

import json
from pathlib import Path

PUBLIC_DIR = Path(__file__).parent.parent / "web" / "public" / "concepts"
OUT_PATH = PUBLIC_DIR / "all-formulas.json"

KEEP_KINDS = {"formula", "law"}

CATEGORY_BY_CHAPTER = {
    **{n: "mechanics"   for n in range(1, 13)},   # Ch01-Ch12
    **{n: "waves_fluid" for n in range(13, 17)},  # Ch13-Ch16
    **{n: "thermo"      for n in range(17, 21)},  # Ch17-Ch20
    **{n: "em"          for n in range(21, 33)},  # Ch21-Ch32
    **{n: "optics"      for n in range(33, 37)},  # Ch33-Ch36
}


def main():
    nodes_out = []
    edges_out = []

    chapter_files = sorted(PUBLIC_DIR.glob("Ch*.json"))
    for f in chapter_files:
        data = json.loads(f.read_text(encoding="utf-8"))
        ch = data["chapter_number"]
        cat = CATEGORY_BY_CHAPTER.get(ch, "other")

        kept_ids = set()
        for n in data["nodes"]:
            if n["kind"] not in KEEP_KINDS:
                continue
            kept_ids.add(n["id"])
            nodes_out.append({
                "id": f"ch{ch:02d}:{n['id']}",
                "chapter": ch,
                "category": cat,
                "label": n["label"],
                "kind": n["kind"],
                "summary": n["summary"],
                "latex": n.get("latex", ""),
                "pages": n.get("pages", []),
            })

        for e in data["edges"]:
            if e["from"] in kept_ids and e["to"] in kept_ids:
                edges_out.append({
                    "from": f"ch{ch:02d}:{e['from']}",
                    "to":   f"ch{ch:02d}:{e['to']}",
                    "reason": e.get("reason", ""),
                })

    out = {"nodes": nodes_out, "edges": edges_out}
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {OUT_PATH.relative_to(PUBLIC_DIR.parent.parent)}")
    print(f"  nodes: {len(nodes_out)}")
    print(f"  edges: {len(edges_out)}")
    by_cat = {}
    for n in nodes_out:
        by_cat.setdefault(n["category"], 0)
        by_cat[n["category"]] += 1
    print(f"  by category: {by_cat}")


if __name__ == "__main__":
    main()
