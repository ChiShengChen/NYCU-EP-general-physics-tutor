import os
import re
import json
import argparse
import numpy as np
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai
from supabase import create_client

load_dotenv(Path(__file__).parent.parent / "web" / ".env.local")

genai.configure(api_key=os.environ["GOOGLE_GENERATIVE_AI_API_KEY"])

PARSED_DIR = Path(__file__).parent.parent / "parsed_lectures"
EMBED_MODEL = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
EMBED_DIM = 768

supabase = create_client(
    os.environ["NEXT_PUBLIC_SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

COURSE_SUMMARY = (
    "This is content from '普通物理' (General Physics, taught by 楊本立 at NYCU "
    "Department of Electrophysics). The course follows University Physics (Young & Freedman) "
    "and covers Ch01–Ch32: kinematics, Newton's laws, work and energy, momentum, "
    "rotational motion, gravitation, oscillations, fluid mechanics, mechanical waves, "
    "sound, thermodynamics, electric charge and field, Gauss's law, electric potential, "
    "capacitance, current and resistance, DC circuits, magnetic fields and forces, "
    "electromagnetic induction, inductance, AC circuits, and electromagnetic waves."
)


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


def chunk_page_markdown(markdown: str, chapter: int, page: int) -> list[dict]:
    chunks = []
    sections = re.split(r"(?=^## )", markdown, flags=re.MULTILINE)

    for section in sections:
        section = section.strip()
        if not section or len(section) < 20:
            continue

        title_match = re.match(r"^## (.+)", section)
        title = title_match.group(1).strip() if title_match else ""

        is_counter = "⚠️" in section or "COUNTEREXAMPLE" in section or "WRONG" in section

        content_type = "text"
        if re.search(r"\$\$.*\$\$", section, re.DOTALL):
            content_type = "formula"
        elif section.startswith("[Figure:"):
            content_type = "figure_description"

        contextualized = f"{COURSE_SUMMARY}\n\nCh{chapter:02d}, Page {page}: {title}\n\n{section}"

        chunks.append({
            "chapter_number": chapter,
            "page_number": page,
            "section_title": title,
            "content": section,
            "content_type": content_type,
            "is_counterexample": is_counter,
            "metadata": {"contextualized_prefix": f"Ch{chapter:02d}, {title}"},
            "contextualized_content": contextualized,
        })

    if not chunks:
        chunks.append({
            "chapter_number": chapter,
            "page_number": page,
            "section_title": "",
            "content": markdown,
            "content_type": "text",
            "is_counterexample": False,
            "metadata": {},
            "contextualized_content": f"{COURSE_SUMMARY}\n\nCh{chapter:02d}, Page {page}\n\n{markdown}",
        })

    return chunks


def normalize(vec: list[float]) -> list[float]:
    arr = np.array(vec)
    norm = np.linalg.norm(arr)
    if norm == 0:
        return vec
    return (arr / norm).tolist()


def embed_texts(texts: list[str]) -> list[list[float]]:
    batch_size = 20
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        result = genai.embed_content(
            model=f"models/{EMBED_MODEL}",
            content=batch,
            task_type="retrieval_document",
            output_dimensionality=EMBED_DIM,
        )
        for emb in result["embedding"]:
            all_embeddings.append(normalize(emb))
    return all_embeddings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--chapters",
        help="Embed only these chapters, e.g. '32' or '1-3' or '1,3,7'. "
             "Default: all parsed files. When set, existing rows for those chapters "
             "are deleted first to avoid duplicates.",
    )
    args = ap.parse_args()

    wanted = parse_chapter_range(args.chapters) if args.chapters else None

    json_files = sorted(PARSED_DIR.glob("*.json"))
    print(f"Found {len(json_files)} parsed lecture files")

    all_chunks = []
    for jf in json_files:
        data = json.loads(jf.read_text(encoding="utf-8"))
        chapter = data["chapter_number"]
        if wanted is not None and chapter not in wanted:
            continue
        for page_data in data["pages"]:
            page_chunks = chunk_page_markdown(page_data["markdown"], chapter, page_data["page"])
            all_chunks.extend(page_chunks)

    if wanted is not None:
        # Idempotent re-runs: clear out any prior rows for the targeted chapters.
        targets = sorted(wanted)
        print(f"Filter: chapters {targets}. Deleting any existing rows for these chapters first...")
        supabase.table("lecture_chunks").delete().in_("chapter_number", targets).execute()

    print(f"Total chunks: {len(all_chunks)}")
    if not all_chunks:
        print("Nothing to do.")
        return

    texts_to_embed = [c["contextualized_content"] for c in all_chunks]
    print("Generating embeddings...")
    embeddings = embed_texts(texts_to_embed)
    print(f"Generated {len(embeddings)} embeddings (dim={EMBED_DIM})")

    print("Uploading to Supabase...")
    batch_size = 50
    for i in range(0, len(all_chunks), batch_size):
        batch = all_chunks[i : i + batch_size]
        batch_embeddings = embeddings[i : i + batch_size]

        rows = []
        for chunk, emb in zip(batch, batch_embeddings):
            rows.append({
                "chapter_number": chunk["chapter_number"],
                "page_number": chunk["page_number"],
                "section_title": chunk["section_title"],
                "content": chunk["content"],
                "content_type": chunk["content_type"],
                "is_counterexample": chunk["is_counterexample"],
                "metadata": chunk["metadata"],
                "embedding": emb,
            })

        supabase.table("lecture_chunks").insert(rows).execute()
        print(f"  Uploaded {min(i + batch_size, len(all_chunks))}/{len(all_chunks)}")

    print(f"\n✅ Done. {len(all_chunks)} chunks embedded and stored.")


if __name__ == "__main__":
    main()
