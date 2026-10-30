#!/usr/bin/env python3
"""
Builds the study guides in docs/ (.docx) from the Markdown files beside this
script, in the guides' own house style.

    python3 docs/source/build_guides.py            # every guide
    python3 docs/source/build_guides.py 2_database # one guide

Why a build at all: the guides used to be edited inside Word's XML by hand,
which is how figures drifted from one guide to the next. Now each guide has a
Markdown source that reads well on GitHub, and this script turns it into the
same document the faculty has been reading: the title page, the contents, the
red-headed tables and the "why it was built this way" boxes.

The package parts that do not change (styles, numbering, footer, fonts) come
from template.docx. Only word/document.xml is written, plus a numbering entry
for each numbered list so every list starts again at 1.

The Markdown dialect, all of it:

    ---                         front matter, one "key: value" per line:
    kicker: Study Guide 1 of 7    the small line under the red caps
    title: System Overview        the large title
    subtitle: ...                 the red line under it
    intro: ...                    the grey paragraph
    updated: ...                  the date line
    footer: PES Study Guide       left of the page number in the footer
    ---
    # Heading                   a section: starts a new page
    ## Heading / ### Heading    sub-sections
    text                        a paragraph; consecutive lines join up
    - item                      a bullet
    1. item                     a numbered step (each list restarts at 1)
    > text                      a note: grey italic, red rule on the left
    :::why TITLE / :::warn TITLE / :::  a beige or an amber box
    ```  ...  ```               a code box, line for line
    | a | b |                   a table; the first row is the header
    <!-- widths: 30,70 -->      optional, before a table: column shares

Inline: `code`, **bold**, *italic*.
"""

from __future__ import annotations

import datetime as _dt
import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
DOCS = HERE.parent
TEMPLATE = HERE / "template.docx"

# Which source becomes which document.
GUIDES = {
    "0_start_here": "PES_Guide_0_Start_Here.docx",
    "1_system_overview": "PES_Guide_1_System_Overview.docx",
    "2_database": "PES_Guide_2_Database.docx",
    "3_login_roles_permissions": "PES_Guide_3_Login_Roles_Permissions.docx",
    "4_security_and_rls": "PES_Guide_4_Security_and_RLS.docx",
    "5_features_and_data_flows": "PES_Guide_5_Features_and_Data_Flows.docx",
    "6_code_structure": "PES_Guide_6_Code_Structure.docx",
    "7_configuration_and_operations": "PES_Guide_7_Configuration_and_Operations.docx",
    "ai_assistant": "PES_Guide_AI_Assistant.docx",
    "ai_assistant_rag_explained": "PES_Guide_AI_Assistant_RAG_Explained.docx",
}

# The house palette and measures, as the guides have always used them.
RED = "8B1E2D"
INK = "1A1A1A"
GREY = "5A5A5A"
CODE_INK = "23303B"
PAGE_WIDTH = 9026  # A4 less 1" margins, in twentieths of a point
NUM_ABSTRACT_DECIMAL = 3  # numbering.xml: the "1." list
NUM_BULLET = 2  # numbering.xml: the small round bullet


# --------------------------------------------------------------------------
# Runs
# --------------------------------------------------------------------------

def _font(name: str) -> str:
    return f'<w:rFonts w:ascii="{name}" w:cs="{name}" w:eastAsia="{name}" w:hAnsi="{name}"/>'


def run(text: str, *, size: int = 21, color: str = INK, bold: bool = False,
        italic: bool = False, mono: bool = False, spacing: int | None = None) -> str:
    props = [_font("Consolas" if mono else "Calibri")]
    props.append("<w:b/><w:bCs/>" if bold else '<w:b w:val="false"/><w:bCs w:val="false"/>')
    props.append("<w:i/><w:iCs/>" if italic else '<w:i w:val="false"/><w:iCs w:val="false"/>')
    props.append(f'<w:color w:val="{color}"/>')
    if spacing is not None:
        props.append(f'<w:spacing w:val="{spacing}"/>')
    props.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
    return f'<w:r><w:rPr>{"".join(props)}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


INLINE = re.compile(r"(`[^`]+`|\*\*.+?\*\*|(?<![\w*])\*(?!\s)[^*]+?(?<!\s)\*(?![\w*]))")


def inline(text: str, *, size: int = 21, color: str = INK, italic: bool = False,
           bold: bool = False, code_size: int | None = None) -> str:
    """Text with `code`, **bold** and *italic* marked, as Word runs."""
    out = []
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("`") and part.endswith("`") and len(part) > 1:
            out.append(run(part[1:-1], size=code_size or size - 2, color=RED, mono=True))
        elif part.startswith("**") and part.endswith("**") and len(part) > 4:
            out.append(run(part[2:-2], size=size, color=color, bold=True, italic=italic))
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            out.append(run(part[1:-1], size=size, color=color, bold=bold, italic=True))
        else:
            out.append(run(part, size=size, color=color, bold=bold, italic=italic))
    return "".join(out)


def plain(text: str) -> str:
    """The text of a line with its inline marks removed (for the contents)."""
    return re.sub(r"`([^`]+)`|\*\*(.+?)\*\*|\*([^*]+)\*", lambda m: next(g for g in m.groups() if g), text)


# --------------------------------------------------------------------------
# Blocks
# --------------------------------------------------------------------------

def para(runs: str, ppr: str = "") -> str:
    return f"<w:p>{f'<w:pPr>{ppr}</w:pPr>' if ppr else ''}{runs}</w:p>"


PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def body(text: str) -> str:
    return para(inline(text), '<w:spacing w:after="150" w:line="276"/>')


def bullet(text: str) -> str:
    return para(inline(text), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/>'
                f'<w:numId w:val="{NUM_BULLET}"/></w:numPr><w:spacing w:after="70" w:line="276"/>')


def numbered(text: str, num_id: int) -> str:
    return para(inline(text), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/>'
                f'<w:numId w:val="{num_id}"/></w:numPr><w:spacing w:after="80" w:line="276"/>')


def note(text: str) -> str:
    return para(inline(text, size=20, color=GREY, italic=True),
                f'<w:pBdr><w:left w:val="single" w:color="{RED}" w:sz="18" w:space="10"/></w:pBdr>'
                '<w:spacing w:after="170" w:before="60" w:line="276"/><w:ind w:left="220"/>')


def heading(level: int, text: str, bookmark: str | None) -> str:
    style, before, after, color, size = {
        1: ("Heading1", 380, 170, RED, 32),
        2: ("Heading2", 300, 120, INK, 26),
        3: ("Heading3", 220, 90, RED, 23),
    }[level]
    r = run(plain(text), size=size, color=color, bold=True)
    if bookmark:
        bid = bookmark.split("_")[-1]
        r = f'<w:bookmarkStart w:id="{bid}" w:name="{bookmark}"/>{r}<w:bookmarkEnd w:id="{bid}"/>'
    return para(r, f'<w:pStyle w:val="{style}"/><w:keepNext/><w:spacing w:after="{after}" w:before="{before}"/>')


def _box(fill: str, margins: tuple[int, int], inner: str, after: bool = True) -> str:
    v, h = margins
    border = "".join(f'<w:{s} w:val="single" w:color="FFFFFF" w:sz="2"/>'
                     for s in ("top", "left", "bottom", "right", "insideH", "insideV"))
    tbl = (f'<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="{PAGE_WIDTH}"/><w:tblBorders>{border}</w:tblBorders>'
           f'</w:tblPr><w:tblGrid><w:gridCol w:w="{PAGE_WIDTH}"/></w:tblGrid><w:tr><w:tc><w:tcPr>'
           f'<w:tcW w:type="dxa" w:w="{PAGE_WIDTH}"/><w:shd w:fill="{fill}" w:color="auto" w:val="clear"/>'
           f'<w:tcMar><w:top w:type="dxa" w:w="{v}"/><w:left w:type="dxa" w:w="{h}"/>'
           f'<w:bottom w:type="dxa" w:w="{v}"/><w:right w:type="dxa" w:w="{h}"/></w:tcMar></w:tcPr>'
           f'{inner}</w:tc></w:tr></w:tbl>')
    return tbl + (SPACER if after else "")


# A small gap after a table or a box, so the next paragraph does not sit
# against its edge.
SPACER = '<w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>'


def callout(kind: str, title: str, paragraphs: list[str]) -> str:
    fill = {"why": "F3F1EC", "warn": "FBF0E6"}[kind]
    inner = para(run(title.upper(), size=17, color=RED, bold=True), '<w:spacing w:after="60"/>')
    for i, p in enumerate(paragraphs):
        spacing = '<w:spacing w:line="276"/>' if i == len(paragraphs) - 1 else '<w:spacing w:after="100" w:line="276"/>'
        inner += para(inline(p, size=20), spacing)
    return _box(fill, (130, 170), inner)


def code_box(lines: list[str]) -> str:
    inner = "".join(para(run(line if line else " ", size=18, color=CODE_INK, mono=True),
                         '<w:spacing w:after="20" w:line="240"/>') for line in lines)
    return _box("F5F5F2", (120, 160), inner)


def table(rows: list[list[str]], shares: list[float] | None) -> str:
    cols = max(len(r) for r in rows)
    rows = [r + [""] * (cols - len(r)) for r in rows]
    if not shares or len(shares) != cols:
        # Wider columns for longer text, but never starved.
        longest = [max(len(plain(r[c])) for r in rows) for c in range(cols)]
        weights = [min(max(n, 8), 60) for n in longest]
        shares = [w / sum(weights) for w in weights]
    total = sum(shares)
    widths = [int(PAGE_WIDTH * s / total) for s in shares]
    widths[-1] = PAGE_WIDTH - sum(widths[:-1])
    border = "".join(f'<w:{s} w:val="single" w:color="C9C9C9" w:sz="4"/>'
                     for s in ("top", "left", "bottom", "right", "insideH", "insideV"))
    out = [f'<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="{PAGE_WIDTH}"/><w:tblBorders>{border}</w:tblBorders>'
           '</w:tblPr><w:tblGrid>' + "".join(f'<w:gridCol w:w="{w}"/>' for w in widths) + "</w:tblGrid>"]
    for i, r in enumerate(rows):
        header = i == 0
        cells = []
        for c, text in enumerate(r):
            fill = RED if header else "FFFFFF"
            content = (run(plain(text), size=19, color="FFFFFF", bold=True) if header
                       else inline(text, size=19, code_size=17))
            cells.append(f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{widths[c]}"/>'
                         f'<w:shd w:fill="{fill}" w:color="auto" w:val="clear"/>'
                         '<w:tcMar><w:top w:type="dxa" w:w="90"/><w:left w:type="dxa" w:w="120"/>'
                         '<w:bottom w:type="dxa" w:w="90"/><w:right w:type="dxa" w:w="120"/></w:tcMar></w:tcPr>'
                         + para(content, '<w:spacing w:after="0" w:line="250"/>') + "</w:tc>")
        trpr = "<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>" if header else "<w:trPr><w:cantSplit/></w:trPr>"
        out.append(f"<w:tr>{trpr}{''.join(cells)}</w:tr>")
    out.append("</w:tbl>")
    return "".join(out) + SPACER


# --------------------------------------------------------------------------
# The title page and the contents
# --------------------------------------------------------------------------

def title_page(meta: dict[str, str]) -> str:
    out = [
        para(run("PERFORMANCE EVALUATION SYSTEM", size=19, color=RED, bold=True, spacing=60),
             '<w:spacing w:after="0" w:before="2200"/>'),
        para(run(meta.get("kicker", ""), size=19, color=GREY),
             f'<w:pBdr><w:bottom w:val="single" w:color="{RED}" w:sz="8" w:space="8"/></w:pBdr>'
             '<w:spacing w:after="260" w:before="40"/>'),
        para(run(meta["title"], size=56, bold=True), '<w:spacing w:after="80"/>'),
        para(run(meta.get("subtitle", ""), size=26, color=RED), '<w:spacing w:after="320"/>'),
        para(inline(meta.get("intro", ""), size=21, color=GREY), '<w:spacing w:after="900" w:line="300"/>'),
        para(run("Faculty of Engineering, University of Sri Jayewardenepura", size=20), '<w:spacing w:after="30"/>'),
        para(run(meta.get("updated", ""), size=19, color=GREY)),
        PAGE_BREAK,
    ]
    return "".join(out)


def contents(entries: list[tuple[int, str, str]]) -> str:
    """The contents, filled in already so it reads in any viewer; Word still
    refreshes it (and adds the page numbers) when the document opens."""
    head = para(run("Contents", size=32, color=RED, bold=True),
                '<w:pStyle w:val="Heading1"/><w:spacing w:after="170" w:before="380"/>')
    first = ('<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'
             '<w:r><w:instrText xml:space="preserve">TOC \\h \\o "1-2"</w:instrText></w:r>'
             '<w:r><w:fldChar w:fldCharType="separate"/></w:r>')
    lines = []
    for i, (level, text, mark) in enumerate(entries):
        size = 21 if level == 1 else 20
        color = INK if level == 1 else GREY
        link = (f'<w:hyperlink w:anchor="{mark}" w:history="1">'
                + run(text, size=size, color=color, bold=level == 1)
                + "</w:hyperlink>")
        indent = "" if level == 1 else '<w:ind w:left="360"/>'
        before = 120 if level == 1 else 0
        ppr = (f'<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{PAGE_WIDTH}"/></w:tabs>'
               f'<w:spacing w:after="40" w:before="{before}"/>{indent}')
        lines.append(f'<w:p><w:pPr>{ppr}</w:pPr>{first if i == 0 else ""}{link}</w:p>')
    end = '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    if not lines:
        lines.append(f"<w:p>{first}</w:p>")
    return (head + '<w:sdt><w:sdtPr><w:alias w:val="Contents"/><w:docPartObj><w:docPartGallery w:val="Table of Contents"/>'
            '<w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>' + "".join(lines) + end
            + "</w:sdtContent></w:sdt>" + PAGE_BREAK)


# --------------------------------------------------------------------------
# Markdown in, blocks out
# --------------------------------------------------------------------------

def parse(source: str) -> tuple[dict[str, str], list[tuple]]:
    meta: dict[str, str] = {}
    lines = source.splitlines()
    i = 0
    if lines and lines[0].strip() == "---":
        i = 1
        while lines[i].strip() != "---":
            key, _, value = lines[i].partition(":")
            meta[key.strip()] = value.strip()
            i += 1
        i += 1

    blocks: list[tuple] = []
    widths: list[float] | None = None

    def flush_para(buf: list[str]) -> None:
        if buf:
            blocks.append(("p", " ".join(s.strip() for s in buf)))
            buf.clear()

    buf: list[str] = []
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            flush_para(buf)
            i += 1
            continue
        m = re.match(r"<!--\s*widths:\s*([\d.,\s]+)-->", s)
        if m:
            flush_para(buf)
            widths = [float(x) for x in m.group(1).split(",") if x.strip()]
            i += 1
            continue
        if s.startswith("<!--"):
            flush_para(buf)
            while "-->" not in lines[i]:
                i += 1
            i += 1
            continue
        if s.startswith("```"):
            flush_para(buf)
            code: list[str] = []
            i += 1
            while not lines[i].strip().startswith("```"):
                code.append(lines[i].rstrip())
                i += 1
            blocks.append(("code", code))
            i += 1
            continue
        m = re.match(r":::(why|warn)\s+(.*)", s)
        if m:
            flush_para(buf)
            kind, title = m.group(1), m.group(2)
            paras: list[str] = []
            cur: list[str] = []
            i += 1
            while lines[i].strip() != ":::":
                if lines[i].strip():
                    cur.append(lines[i].strip())
                elif cur:
                    paras.append(" ".join(cur))
                    cur = []
                i += 1
            if cur:
                paras.append(" ".join(cur))
            blocks.append(("callout", kind, title, paras))
            i += 1
            continue
        m = re.match(r"(#{1,3})\s+(.*)", s)
        if m:
            flush_para(buf)
            blocks.append(("h", len(m.group(1)), m.group(2)))
            i += 1
            continue
        if s.startswith("|"):
            flush_para(buf)
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in re.split(r"(?<!\\)\|", lines[i].strip())[1:-1]]
                cells = [c.replace("\\|", "|") for c in cells]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            blocks.append(("table", rows, widths))
            widths = None
            continue
        if s.startswith("> "):
            flush_para(buf)
            text = [s[2:]]
            i += 1
            while i < len(lines) and lines[i].strip().startswith(">"):
                text.append(lines[i].strip()[1:].strip())
                i += 1
            blocks.append(("note", " ".join(text)))
            continue
        m = re.match(r"(-|\d+\.)\s+(.*)", s)
        if m:
            flush_para(buf)
            kind = "ul" if m.group(1) == "-" else "ol"
            items = [m.group(2)]
            i += 1
            while i < len(lines):
                t = lines[i]
                mm = re.match(r"\s*(-|\d+\.)\s+(.*)", t)
                if mm and (("ul" if mm.group(1) == "-" else "ol") == kind):
                    items.append(mm.group(2))
                elif t.startswith("  ") and t.strip() and not re.match(r"\s*(-|\d+\.)\s", t):
                    items[-1] += " " + t.strip()
                else:
                    break
                i += 1
            blocks.append((kind, items))
            continue
        buf.append(line)
        i += 1
    flush_para(buf)
    return meta, blocks


def render(meta: dict[str, str], blocks: list[tuple]) -> tuple[str, int]:
    """The document body, and how many numbered lists it holds."""
    entries: list[tuple[int, str, str]] = []
    marks: list[str | None] = []
    n = 0
    for b in blocks:
        if b[0] == "h" and b[1] <= 2:
            n += 1
            mark = f"_Toc_{n}"
            entries.append((b[1], plain(b[2]), mark))
            marks.append(mark)
        elif b[0] == "h":
            marks.append(None)

    out = [title_page(meta), contents(entries)]
    lists = 0
    heading_marks = iter(marks)
    first_h1 = True
    for b in blocks:
        kind = b[0]
        if kind == "h":
            if b[1] == 1:
                if not first_h1:
                    out.append(PAGE_BREAK)
                first_h1 = False
            out.append(heading(b[1], b[2], next(heading_marks)))
        elif kind == "p":
            out.append(body(b[1]))
        elif kind == "ul":
            out.extend(bullet(t) for t in b[1])
        elif kind == "ol":
            lists += 1
            out.extend(numbered(t, 100 + lists) for t in b[1])
        elif kind == "note":
            out.append(note(b[1]))
        elif kind == "callout":
            out.append(callout(b[1], b[2], b[3]))
        elif kind == "code":
            out.append(code_box(b[1]))
        elif kind == "table":
            out.append(table(b[1], b[2]))
    return "".join(out), lists


# --------------------------------------------------------------------------
# The package
# --------------------------------------------------------------------------

def build(name: str) -> Path:
    src = HERE / f"{name}.md"
    meta, blocks = parse(src.read_text(encoding="utf-8"))
    body_xml, lists = render(meta, blocks)

    with zipfile.ZipFile(TEMPLATE) as tz:
        parts = {n: tz.read(n) for n in tz.namelist()}

    doc = parts["word/document.xml"].decode("utf-8")
    sect = re.search(r"<w:sectPr\b.*?</w:sectPr>", doc, re.S).group(0)
    doc = re.sub(r"<w:body>.*</w:body>", lambda _: f"<w:body>{body_xml}{sect}</w:body>", doc, flags=re.S)
    parts["word/document.xml"] = doc.encode("utf-8")

    # One numbering instance per numbered list, each restarting at 1.
    numbering = parts["word/numbering.xml"].decode("utf-8")
    numbering = re.sub(r'<w:num w:numId="1\d\d".*?</w:num>', "", numbering, flags=re.S)
    extra = "".join(
        f'<w:num w:numId="{100 + k}"><w:abstractNumId w:val="{NUM_ABSTRACT_DECIMAL}"/>'
        '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'
        for k in range(1, lists + 1))
    numbering = numbering.replace("</w:numbering>", extra + "</w:numbering>")
    parts["word/numbering.xml"] = numbering.encode("utf-8")

    footer = parts["word/footer1.xml"].decode("utf-8")
    footer = re.sub(r"(<w:t[^>]*>)[^<]*·\s*page\s*(</w:t>)",
                    lambda m: f"{m.group(1)}{escape(meta.get('footer', 'PES Study Guide'))}  ·  page {m.group(2)}", footer)
    parts["word/footer1.xml"] = footer.encode("utf-8")

    now = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    core = parts["docProps/core.xml"].decode("utf-8")
    title = escape(f"PES — {meta['title']}")
    if "<dc:title>" in core:
        core = re.sub(r"<dc:title>.*?</dc:title>", f"<dc:title>{title}</dc:title>", core)
    else:
        core = core.replace("<dc:creator>", f"<dc:title>{title}</dc:title><dc:creator>")
    core = re.sub(r"<dc:creator>.*?</dc:creator>", "<dc:creator>PES</dc:creator>", core)
    core = re.sub(r"<cp:lastModifiedBy>.*?</cp:lastModifiedBy>", "<cp:lastModifiedBy>PES</cp:lastModifiedBy>", core)
    core = re.sub(r'(<dcterms:modified[^>]*>).*?(</dcterms:modified>)', lambda m: m.group(1) + now + m.group(2), core)
    parts["docProps/core.xml"] = core.encode("utf-8")

    out = DOCS / GUIDES[name]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        # [Content_Types].xml first, as Word expects.
        order = ["[Content_Types].xml"] + [n for n in parts if n != "[Content_Types].xml"]
        for n in order:
            z.writestr(n, parts[n])
    return out


def main(argv: list[str]) -> None:
    names = argv or [n for n in GUIDES if (HERE / f"{n}.md").exists()]
    for name in names:
        print("built", build(name).relative_to(DOCS.parent))


if __name__ == "__main__":
    main(sys.argv[1:])
