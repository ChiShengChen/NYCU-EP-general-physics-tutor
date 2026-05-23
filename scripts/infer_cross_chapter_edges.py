"""
Stage 2: ask Gemini 2.5 Pro to infer **cross-chapter** prerequisite edges
between formula / law nodes from all 36 chapters.

Input:  web/public/concepts/all-formulas.json (591 nodes)
Output: web/public/concepts/cross-chapter-edges.json
    {
      "edges": [
        { "from": "ch04:newtons-2nd-law", "to": "ch06:work-energy-theorem",
          "reason": "<= 50 字說明為何 to 直接依賴 from" }
      ],
      "model": "gemini-2.5-pro",
      "usage": { "input_tokens": ..., "output_tokens": ... }
    }

User constraint: 邊少但準。Prompt instructs the model to:
- ONLY emit edges where it is highly confident
- ONLY emit cross-chapter edges (skip same-chapter — those already exist)
- Skip transitive edges (if A→B and B→C exist, don't add A→C)

Usage:
    python scripts/infer_cross_chapter_edges.py
    python scripts/infer_cross_chapter_edges.py --temperature 0.2
"""

import os
import json
import argparse
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv(Path(__file__).parent.parent / "web" / ".env.local")
genai.configure(api_key=os.environ["GOOGLE_GENERATIVE_AI_API_KEY"])

ROOT = Path(__file__).parent.parent
INPUT_PATH = ROOT / "web" / "public" / "concepts" / "all-formulas.json"
OUTPUT_PATH = ROOT / "web" / "public" / "concepts" / "cross-chapter-edges.json"

MODEL_NAME = os.environ.get("CROSS_EDGE_MODEL", "gemini-2.5-pro")

# Gemini 2.5 Pro pricing (USD per 1M tokens, as of 2025)
PRICE_INPUT_PER_M = 1.25
PRICE_OUTPUT_PER_M = 10.0

SCHEMA = {
    "type": "object",
    "properties": {
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from": {"type": "string", "description": "prerequisite node id, e.g. ch04:newtons-2nd-law"},
                    "to":   {"type": "string", "description": "dependent node id"},
                    "reason": {"type": "string", "description": "<= 50 字繁中說明：為何 to 直接依賴 from"},
                    "confidence": {"type": "string", "enum": ["high", "medium"], "description": "信心等級"},
                },
                "required": ["from", "to", "reason", "confidence"],
            },
        },
    },
    "required": ["edges"],
}

PROMPT_HEADER = """你是物理課程知識圖譜的跨章節先備關係推理器。

下面是普通物理 (University Physics, Young & Freedman) 36 章共 591 個公式/定律節點，
每個節點以 JSON 格式列出，包含：
- id：跨章節唯一 (例如 "ch04:newtons-2nd-law")
- chapter：章節編號 1-36
- label：中文短名
- kind：formula 或 law
- summary：一句話說明
- latex：KaTeX 字串

請推斷**跨章節**的直接先備關係邊（from → to 表示「理解 from 才能推導/理解 to」）。

**嚴格規則**：

1. **只輸出跨章節邊**：from 與 to 必須來自不同章節。同章內邊由其他流程處理，這裡跳過。

2. **只輸出你高度確信的邊**：寧可少輸出也不要輸出可疑的邊。每條邊都要能用一句話清楚說明為何 to 直接依賴 from。

3. **不要傳遞性邊**：如果 A→B 且 B→C 都成立，那 A→C 屬於傳遞性，不要輸出。只連直接的下一層依賴。

4. **不要章節跳太遠**：from 通常應該在 to 的同一物理主題或鄰近章節。例如：
   - ✅ Ch04 牛頓第二定律 → Ch06 動能定理（功-能定理直接從 F=ma 積分得來）
   - ✅ Ch29 法拉第定律 → Ch31 AC 電路阻抗（感抗源自感應電動勢）
   - ❌ Ch01 向量點積 → Ch20 熵變化（太遠、太抽象、學生不會這樣理解）

5. **常見可靠先備關係例子**（給你建立信心校準）：
   - 牛頓定律 → 動量定理、動能定理、功能定理
   - 動能/位能定義 → 力學能守恆 → 簡諧運動能量
   - 角動量定義 → 角動量守恆
   - 庫倫定律 → 高斯定律應用、電場
   - 電位 → 電容、電勢能
   - 法拉第定律 → 互感、自感、LC/RC 振盪
   - 馬克士威方程 → 電磁波波動方程
   - 機械波/波速公式 → 干涉、繞射

6. **confidence 欄位**：用 "high" 表示這條邊是經典物理教學中確定的依賴關係；用 "medium" 表示合理但不到絕對。**只允許 high 和 medium，不要輸出 low 信心邊**。

7. `from` 和 `to` 必須完全比對下方節點清單中的 id（含 ch 前綴）。

**目標**：輸出 200-500 條高品質跨章邊。寧可只輸出 200 條 high-confidence 邊，不要輸出 800 條混雜邊。

節點清單（JSON）：
"""


def cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * PRICE_INPUT_PER_M + output_tokens * PRICE_OUTPUT_PER_M) / 1_000_000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--temperature", type=float, default=0.2)
    args = ap.parse_args()

    data = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    nodes = data["nodes"]
    print(f"Loaded {len(nodes)} nodes from {INPUT_PATH.relative_to(ROOT)}")

    # Compact node representation to keep input tokens down.
    compact_nodes = [
        {
            "id": n["id"],
            "chapter": n["chapter"],
            "label": n["label"],
            "kind": n["kind"],
            "summary": n["summary"],
            "latex": n["latex"],
        }
        for n in nodes
    ]

    prompt = PROMPT_HEADER + json.dumps(compact_nodes, ensure_ascii=False, indent=None)

    model = genai.GenerativeModel(
        MODEL_NAME,
        generation_config={
            "response_mime_type": "application/json",
            "response_schema": SCHEMA,
            "temperature": args.temperature,
            "max_output_tokens": 32768,
        },
    )

    print(f"Calling {MODEL_NAME} (temp={args.temperature})...")
    resp = model.generate_content(prompt)
    result = json.loads(resp.text)

    # Validate edges: drop any with bad ids or same-chapter pairs.
    node_ids = {n["id"] for n in nodes}
    chapter_of = {n["id"]: n["chapter"] for n in nodes}
    valid_edges = []
    skipped_bad_id = 0
    skipped_same_chapter = 0
    for e in result["edges"]:
        if e["from"] not in node_ids or e["to"] not in node_ids:
            skipped_bad_id += 1
            continue
        if chapter_of[e["from"]] == chapter_of[e["to"]]:
            skipped_same_chapter += 1
            continue
        valid_edges.append(e)

    usage = resp.usage_metadata
    in_tok, out_tok = usage.prompt_token_count, usage.candidates_token_count
    c = cost_usd(in_tok, out_tok)

    out = {
        "edges": valid_edges,
        "model": MODEL_NAME,
        "usage": {"input_tokens": in_tok, "output_tokens": out_tok},
    }
    OUTPUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print(f"Total edges from model: {len(result['edges'])}")
    print(f"  skipped (bad id):      {skipped_bad_id}")
    print(f"  skipped (same chapter): {skipped_same_chapter}")
    print(f"  kept (cross-chapter):   {len(valid_edges)}")
    by_conf = {}
    for e in valid_edges:
        by_conf[e["confidence"]] = by_conf.get(e["confidence"], 0) + 1
    print(f"  by confidence:          {by_conf}")
    print()
    print(f"Tokens: in={in_tok:,} out={out_tok:,}  cost≈${c:.4f}")
    print(f"→ {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
