"""
Extract concept / formula nodes (with prerequisite edges) from parsed lecture markdown.

Output: parsed_lectures/Ch{N}.concepts.json
    {
      "chapter_number": int,
      "nodes": [
        { "id", "label", "kind", "summary", "latex"?, "pages": [int] }
      ],
      "edges": [
        { "from", "to", "reason" }
      ],
      "usage": { "input_tokens", "output_tokens" }
    }

Usage:
    python scripts/extract_concepts.py --chapters 1
    python scripts/extract_concepts.py --chapters 1-3
    python scripts/extract_concepts.py            # all chapters
"""

import os
import json
import argparse
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv(Path(__file__).parent.parent / "web" / ".env.local")
genai.configure(api_key=os.environ["GOOGLE_GENERATIVE_AI_API_KEY"])

PARSED_DIR = Path(__file__).parent.parent / "parsed_lectures"
MODEL_NAME = os.environ.get("EXTRACT_MODEL", "gemini-2.5-flash")

# Gemini 2.5 Flash pricing (USD per 1M tokens, as of 2025)
PRICE_INPUT_PER_M = 0.30
PRICE_OUTPUT_PER_M = 2.50

KIND_VALUES = ["concept", "definition", "formula", "law", "principle", "method"]

SCHEMA = {
    "type": "object",
    "properties": {
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "kebab-case slug, unique within chapter"},
                    "label": {"type": "string", "description": "繁體中文短名稱，10 字以內"},
                    "kind": {"type": "string", "enum": KIND_VALUES},
                    "summary": {"type": "string", "description": "一句話說明（繁中），<= 60 字"},
                    "latex": {"type": "string", "description": "若為公式/定律則給 KaTeX 字串，否則空字串"},
                    "pages": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["id", "label", "kind", "summary", "latex", "pages"],
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from": {"type": "string", "description": "prerequisite node id"},
                    "to": {"type": "string", "description": "dependent node id"},
                    "reason": {"type": "string", "description": "一句話：為何 to 需要先理解 from"},
                },
                "required": ["from", "to", "reason"],
            },
        },
    },
    "required": ["nodes", "edges"],
}

PROMPT = """你是物理課程知識圖譜抽取器。下面是普通物理「第 {chapter} 章」的講義 markdown（含頁碼標記）。

請抽出本章的「概念 / 定義 / 公式 / 定律 / 原理 / 方法」節點，並建立**章內**先備關係邊。

**節點選取原則（重要）**：
1. 只抽「**本章主軸**的具體知識點」——可被單獨命名、可被作業/考試題目測驗的最小單位。
   例如：「位移的定義」「等加速運動公式」「向量內積的分量式」「自由體圖法」各為獨立節點。
2. **跳過下列內容，不要抽成節點**：
   - 課程地圖、章節大綱、Outline 頁面（通常出現在前 1–3 頁，僅列出全書/全章主題）
   - 「Physics Concepts Overview」「Classification of Physics」這類**展示物理學整體架構**的圖（例如把粒子/運動學/動力學/波/古典力學/量子力學等其他章節主題畫在一張圖上的總覽圖）——這些只是地圖，**不是本章的具體知識點**
   - 其他章節的代表公式（例如 Ch01 開場列出的 F=ma、Maxwell、Schrödinger 只是示意，不要當 Ch01 節點）
   - 抽象的後設敘述（如「物理是什麼」「物理理論」「數學語言」「實驗 vs 理論」「科學的本質」）
   - 圖片描述、講者介紹、學期說明、出席率統計、課程公告

**判斷準則**：問自己「這個節點會出現在本章的作業/考試題目中嗎？」如果答案是否定的，就不要抽。
例如 Ch01 主要在教「單位、量度、向量」——學生會被考向量內積，但**不會**被考「粒子是什麼」。
3. 不要把整節標題當節點；要拆到具體概念。但也別過細到每個例題。
4. **一章目標 25–40 個節點**。寧可少而精，不要多而雜。
5. `id` 用英文 kebab-case，章內唯一，例如 `velocity-definition`、`kinematic-eq-constant-a`。
6. `latex` 只在 kind 是 formula/law 時填寫 KaTeX（不要 $ 包夾），其他類型給空字串 ""。
7. `pages` 填這個概念在第幾頁出現（可多頁）。

**邊的原則**：
8. 邊只連**直接先備**關係，不要傳遞性的（A→B、B→C 就不要再寫 A→C）。
9. 邊的 from/to 必須都是本次輸出 nodes 裡的 id。
10. `reason` 一句話說明為何 to 需要先理解 from。

講義內容：
---
{markdown}
---

輸出 JSON。"""


def parse_chapter_range(spec: str) -> list[int]:
    chapters: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            chapters.update(range(int(a), int(b) + 1))
        elif part:
            chapters.add(int(part))
    return sorted(chapters)


def extract_chapter(chapter: int, temperature: float = 0.0) -> dict:
    md_path = PARSED_DIR / f"Ch{chapter:02d}.md"
    if not md_path.exists():
        raise FileNotFoundError(md_path)
    markdown = md_path.read_text(encoding="utf-8")

    model = genai.GenerativeModel(
        MODEL_NAME,
        generation_config={
            "response_mime_type": "application/json",
            "response_schema": SCHEMA,
            "temperature": temperature,
            "max_output_tokens": 32768,
        },
    )
    resp = model.generate_content(PROMPT.format(chapter=chapter, markdown=markdown))
    data = json.loads(resp.text)

    usage = resp.usage_metadata
    data["chapter_number"] = chapter
    data["usage"] = {
        "input_tokens": usage.prompt_token_count,
        "output_tokens": usage.candidates_token_count,
    }
    return data


def cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * PRICE_INPUT_PER_M + output_tokens * PRICE_OUTPUT_PER_M) / 1_000_000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chapters", default="1", help="e.g. '1', '1-3', '1,5,7'")
    ap.add_argument("--temperature", type=float, default=None, help="Override default temperature 0.0")
    args = ap.parse_args()

    total_in = total_out = 0
    temp = args.temperature if args.temperature is not None else 0.0
    for ch in parse_chapter_range(args.chapters):
        print(f"\n─── Ch{ch:02d} (temp={temp}) ───")
        try:
            data = extract_chapter(ch, temperature=temp)
        except Exception as e:
            print(f"❌ Ch{ch:02d} failed: {e}")
            continue

        out_path = PARSED_DIR / f"Ch{ch:02d}.concepts.json"
        out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        u = data["usage"]
        c = cost_usd(u["input_tokens"], u["output_tokens"])
        total_in += u["input_tokens"]
        total_out += u["output_tokens"]
        print(f"  nodes: {len(data['nodes'])}  edges: {len(data['edges'])}")
        print(f"  tokens: in={u['input_tokens']:,}  out={u['output_tokens']:,}  cost≈${c:.4f}")
        print(f"  → {out_path.relative_to(PARSED_DIR.parent)}")

    if total_in:
        total_cost = cost_usd(total_in, total_out)
        print(f"\n=== Total: in={total_in:,}  out={total_out:,}  cost≈${total_cost:.4f} ===")


if __name__ == "__main__":
    main()
