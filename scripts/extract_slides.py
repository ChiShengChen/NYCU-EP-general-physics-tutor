"""
Extract PDF lecture pages as JPEG images and upload to Supabase Storage.

Images are stored as: slides/ch_{N}_page_{M}.jpg  (N is the chapter number, 1..31)
Accessible via public URL:
    {SUPABASE_URL}/storage/v1/object/public/slides/ch_{N}_page_{M}.jpg

Usage:
    python scripts/extract_slides.py                 # all chapters
    python scripts/extract_slides.py --chapters 1-3  # only Ch01..Ch03
"""

import os
import re
import io
import time
import argparse
from pathlib import Path
from dotenv import load_dotenv
import pypdfium2 as pdfium
from supabase import create_client

load_dotenv(Path(__file__).parent.parent / "web" / ".env.local")

PDF_DIR = Path(__file__).parent.parent.parent / "普通物理_楊本立老師"
BUCKET_NAME = "slides"
SCALE = 200 / 72  # 200 DPI rendering
JPEG_QUALITY = 80


def parse_chapter_from_filename(name: str) -> int:
    m = re.match(r"Ch(\d+)", name)
    return int(m.group(1)) if m else 0


def parse_chapter_range(spec: str) -> set[int]:
    chapters: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            chapters.update(range(int(a), int(b) + 1))
        elif part:
            chapters.add(int(part))
    return chapters


def get_supabase():
    return create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def ensure_bucket(sb):
    buckets = sb.storage.list_buckets()
    if not any(b.name == BUCKET_NAME for b in buckets):
        sb.storage.create_bucket(BUCKET_NAME, options={"public": True})
        print(f"✅ Created public bucket: {BUCKET_NAME}")
    else:
        print(f"📦 Bucket already exists: {BUCKET_NAME}")


def render_page_jpeg(pdf_path: str, page_idx: int) -> bytes:
    pdf = pdfium.PdfDocument(pdf_path)
    page = pdf[page_idx]
    bitmap = page.render(scale=SCALE)
    img = bitmap.to_pil()
    pdf.close()

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return buf.getvalue()


def upload_slide(sb, chapter: int, page: int, img_bytes: bytes) -> str:
    storage_path = f"ch_{chapter}_page_{page}.jpg"
    sb.storage.from_(BUCKET_NAME).upload(
        storage_path,
        img_bytes,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )
    return storage_path


def process_pdf(sb, pdf_path: Path):
    name = pdf_path.stem
    chapter = parse_chapter_from_filename(name)

    pdf = pdfium.PdfDocument(str(pdf_path))
    num_pages = len(pdf)
    pdf.close()

    print(f"\n{'='*60}")
    print(f"📄 {name} (Ch{chapter:02d}, {num_pages} pages)")
    print(f"{'='*60}")

    for i in range(num_pages):
        page_num = i + 1
        print(f"  Page {page_num}/{num_pages}...", end=" ", flush=True)

        start = time.time()
        img_bytes = render_page_jpeg(str(pdf_path), i)
        size_kb = len(img_bytes) / 1024

        storage_path = upload_slide(sb, chapter, page_num, img_bytes)
        elapsed = time.time() - start

        print(f"✅ ({size_kb:.0f}KB, {elapsed:.1f}s) → {storage_path}")

    return num_pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chapters", help="e.g. '1-3' or '5'. Default: all.")
    args = ap.parse_args()

    wanted = parse_chapter_range(args.chapters) if args.chapters else None

    sb = get_supabase()
    ensure_bucket(sb)

    pdfs = sorted(PDF_DIR.glob("Ch*.pdf"))
    print(f"\nFound {len(pdfs)} PDFs in {PDF_DIR}")
    if wanted is not None:
        print(f"Filter: chapters {sorted(wanted)}")

    total_pages = 0
    for pdf_path in pdfs:
        chapter = parse_chapter_from_filename(pdf_path.stem)
        if wanted is not None and chapter not in wanted:
            continue
        total_pages += process_pdf(sb, pdf_path)

    base_url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    print(f"\n{'='*60}")
    print(f"✅ All done! Uploaded {total_pages} slide images.")
    print(f"📎 Public URL pattern: {base_url}/storage/v1/object/public/{BUCKET_NAME}/ch_{{N}}_page_{{M}}.jpg")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
