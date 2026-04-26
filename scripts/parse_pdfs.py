"""
Parse general physics PDF lectures into structured Markdown using Gemini Vision.

Source PDFs are named "Ch01 ...", "Ch02 ...", up to "Ch31 ...".
The leading "ChNN" determines chapter_number (1..31). The remaining filename
words are kept as the chapter title.

Usage:
    python scripts/parse_pdfs.py                 # parse all chapters
    python scripts/parse_pdfs.py --chapters 1-3  # parse Ch01..Ch03 only
    python scripts/parse_pdfs.py --chapters 5    # parse Ch05 only
"""

import os
import re
import json
import io
import time
import argparse
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai
import pypdfium2 as pdfium

load_dotenv(Path(__file__).parent.parent / "web" / ".env.local")

genai.configure(api_key=os.environ["GOOGLE_GENERATIVE_AI_API_KEY"])

PDF_DIR = Path(__file__).parent.parent.parent / "普通物理_楊本立老師"
OUTPUT_DIR = Path(__file__).parent.parent / "parsed_lectures"
OUTPUT_DIR.mkdir(exist_ok=True)

MODEL = os.environ.get("VISION_MODEL", "gemini-2.5-flash")

EXTRACTION_PROMPT = """You are a physics lecture PDF parser for a university "General Physics" course
(普通物理, 楊本立老師, NYCU Department of Electrophysics).
Extract ALL content from this lecture slide into structured Markdown.

RULES:
1. ALL mathematical formulas MUST use LaTeX notation: inline $...$ or display $$...$$
2. Preserve logical structure: use ## for section headers, - for bullet points
3. For diagrams/figures, write [Figure: detailed description of what the figure shows, including axis labels, vectors, free-body diagrams, and physical meaning]
4. Preserve BOTH Chinese and English text exactly as shown
5. If a derivation or formula is explicitly marked as WRONG or incorrect in the slide, wrap it in a block:
   > ⚠️ COUNTEREXAMPLE (this derivation is intentionally wrong)
   > [the wrong content]
   > CORRECTION: [why it's wrong]
6. Preserve the derivation flow — use → or ⟹ to show logical progression
7. For boxed/highlighted results, use **bold** or > blockquote
8. Output ONLY the extracted Markdown content. No commentary.

IMPORTANT: This content will be used by a RAG system to answer student questions.
Accuracy of formulas is CRITICAL — a wrong subscript, sign, or vector arrow can mislead students."""


def parse_chapter_from_filename(name: str) -> tuple[int, str]:
    """'Ch01 Units,Physical Quantities,Vector' -> (1, 'Units,Physical Quantities,Vector')."""
    m = re.match(r"Ch(\d+)\s*(.*)", name)
    if not m:
        return 0, name
    return int(m.group(1)), m.group(2).strip()


def pdf_page_to_image_bytes(pdf_path: str, page_idx: int) -> bytes:
    pdf = pdfium.PdfDocument(pdf_path)
    page = pdf[page_idx]
    bitmap = page.render(scale=200 / 72)
    img = bitmap.to_pil()
    pdf.close()

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def extract_page(pdf_path: str, page_idx: int, max_retries: int = 3) -> str:
    img_bytes = pdf_page_to_image_bytes(pdf_path, page_idx)

    model = genai.GenerativeModel(MODEL)
    for attempt in range(max_retries):
        try:
            response = model.generate_content(
                [
                    EXTRACTION_PROMPT,
                    {"mime_type": "image/png", "data": img_bytes},
                ],
                generation_config=genai.types.GenerationConfig(temperature=0, max_output_tokens=4096),
            )
            # Check if model blocked output (RECITATION=4, SAFETY=3, OTHER=5)
            try:
                cand = response.candidates[0]
                fr = getattr(cand, "finish_reason", None)
                fr_int = int(fr) if fr is not None else 1
                if fr_int in (3, 4, 5):
                    reason = {3: "SAFETY", 4: "RECITATION", 5: "OTHER"}[fr_int]
                    print(f"\n    ⚠️  Page {page_idx+1} blocked ({reason}); writing placeholder.", end=" ", flush=True)
                    return f"[Page blocked by Gemini content filter: {reason}. Original slide preserved as image.]"
            except (IndexError, AttributeError):
                pass
            return response.text
        except ValueError as e:
            # response.text raised ValueError because of finish_reason 3/4/5
            msg = str(e)
            if "finish_reason" in msg or "RECITATION" in msg or "copyrighted" in msg or "safety" in msg.lower():
                print(f"\n    ⚠️  Page {page_idx+1} blocked: {msg[:120]}; writing placeholder.", end=" ", flush=True)
                return "[Page blocked by Gemini content filter. Original slide preserved as image.]"
            if attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"\n    ⚠️  {e}. Retry in {wait}s...", end=" ", flush=True)
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"\n    ⚠️  {e}. Retry in {wait}s...", end=" ", flush=True)
                time.sleep(wait)
            else:
                raise


def parse_pdf(pdf_path: Path):
    name = pdf_path.stem
    chapter, title = parse_chapter_from_filename(name)

    pdf = pdfium.PdfDocument(str(pdf_path))
    num_pages = len(pdf)
    pdf.close()

    print(f"\n{'='*60}")
    print(f"解析: Ch{chapter:02d} — {title} ({num_pages} pages)")
    print(f"{'='*60}")

    pages = []
    for i in range(num_pages):
        print(f"  Page {i+1}/{num_pages}...", end=" ", flush=True)
        start = time.time()
        md = extract_page(str(pdf_path), i)
        elapsed = time.time() - start
        print(f"✅ ({elapsed:.1f}s)")
        pages.append({"page": i + 1, "markdown": md})

        # Rate limit: ~4s between requests (Gemini free tier = 15 RPM)
        if i < num_pages - 1:
            sleep_time = max(0, 4.0 - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

    out = {
        "source_file": name,
        "chapter_number": chapter,
        "chapter_title": title,
        "total_pages": num_pages,
        "pages": pages,
    }

    out_path = OUTPUT_DIR / f"Ch{chapter:02d}.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    full_md = f"# Ch{chapter:02d} — {title}\n\n"
    for p in pages:
        full_md += f"---\n\n*Page {p['page']}*\n\n{p['markdown']}\n\n"

    md_path = OUTPUT_DIR / f"Ch{chapter:02d}.md"
    md_path.write_text(full_md, encoding="utf-8")

    print(f"  📄 JSON: {out_path}")
    print(f"  📝 Markdown: {md_path}")
    return out


def parse_chapter_range(spec: str) -> set[int]:
    """'1-3' -> {1,2,3}; '5' -> {5}; '1,3,7' -> {1,3,7}."""
    chapters: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            chapters.update(range(int(a), int(b) + 1))
        elif part:
            chapters.add(int(part))
    return chapters


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chapters", help="e.g. '1-3' or '5' or '1,3,7'. Default: all.")
    args = ap.parse_args()

    wanted = parse_chapter_range(args.chapters) if args.chapters else None

    pdfs = sorted(PDF_DIR.glob("Ch*.pdf"))
    print(f"Found {len(pdfs)} PDFs in {PDF_DIR}")
    if wanted is not None:
        print(f"Filter: chapters {sorted(wanted)}")

    for pdf_path in pdfs:
        chapter, _ = parse_chapter_from_filename(pdf_path.stem)
        if wanted is not None and chapter not in wanted:
            continue

        out_path = OUTPUT_DIR / f"Ch{chapter:02d}.json"
        if out_path.exists():
            print(f"⏭️  Skip (already parsed): Ch{chapter:02d}")
            continue
        parse_pdf(pdf_path)

    print(f"\n{'='*60}")
    print(f"✅ All done. Output in: {OUTPUT_DIR}/")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
