"""
Extract the Faculty Handbook 2026 into structured JSON for chunking.

Headings are identified by the PDF's own typography rather than by guessing
from the text. In this document the body is Montserrat-Regular at 11-12pt and
every heading is either bold or set at 14pt and above, which is far more
reliable than the regex heuristics the first version used -- those collapsed
96 pages into 8 sections because the extracted text has no blank lines to
separate paragraphs by.

Output: handbook_structured.json
    [{ "page": 27, "section": "Dean's List", "text": "A student who ..." }, ...]

Usage: python extract_handbook.py <handbook.pdf>
"""

import json
import re
import sys
from pathlib import Path

import pymupdf

HEADING_MIN_SIZE = 13.5
HEADING_MAX_CHARS = 80


def line_text(line):
    return "".join(s["text"] for s in line["spans"])


def is_heading(line):
    spans = [s for s in line["spans"] if s["text"].strip()]
    if not spans:
        return False
    text = line_text(line).strip()
    if not text or len(text) > HEADING_MAX_CHARS:
        return False
    if re.fullmatch(r"[\d\s.\-–—]+", text):        # bare page numbers / rules
        return False
    if len(re.sub(r"[^A-Za-z]", "", text)) < 3:
        return False
    if text.endswith((".", ",", ";", ":")):
        return False

    weighted = sum(len(s["text"]) for s in spans)
    bold = sum(len(s["text"]) for s in spans if "Bold" in s["font"] or "Black" in s["font"])
    big = max(s["size"] for s in spans)
    return big >= HEADING_MIN_SIZE or bold > weighted * 0.6


def clean(text):
    # The cover art doubles its letters ("FFAACCUULLTTYY") through overprint;
    # nothing downstream benefits from that, and it poisons any search.
    text = re.sub(r"\b(\w)\1(\w)\2(\w)\3", r"\1\2\3", text)
    return re.sub(r"\s+", " ", text).strip()


def extract(pdf_path):
    doc = pymupdf.open(pdf_path)
    records = []
    section = "Faculty of Engineering — Student Guide 2026"

    for page_index, page in enumerate(doc):
        page_no = page_index + 1
        buffer = []

        def flush():
            if not buffer:
                return
            body = clean(" ".join(buffer))
            if len(body.split()) >= 5:
                records.append({"page": page_no, "section": section, "text": body})
            buffer.clear()

        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                raw = line_text(line).strip()
                if not raw:
                    continue
                if is_heading(line):
                    flush()
                    section = clean(raw)
                else:
                    buffer.append(raw)
        flush()

    return records


def main():
    pdf = Path(sys.argv[1])
    out = Path(__file__).with_name("handbook_structured.json")
    records = extract(pdf)
    out.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")

    sections = {r["section"] for r in records}
    chars = sum(len(r["text"]) for r in records)
    print(f"records  {len(records)}")
    print(f"sections {len(sections)}")
    print(f"chars    {chars:,}")
    print(f"pages    {min(r['page'] for r in records)}-{max(r['page'] for r in records)}")
    print(f"wrote    {out.name}")


if __name__ == "__main__":
    main()
