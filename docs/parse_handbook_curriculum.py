"""
Pull the curriculum tables out of the Faculty Handbook 2026.

Each semester is one table: course code, title, credit value, category, and
whether it contributes to GPA. The category cell is merged across the rows it
covers, so in the extracted text it appears once and the rows either side of it
belong to it.

Reading it took two passes to get right. The rule is not "a category carries
down from where it appears" -- it is that a category cell OPENS a group at the
course it is attached to (the one on its own line, or the one immediately
above), and that group runs until the next category cell. Getting this wrong
put Advanced Algorithms, Concurrent Processing and GPU Programming under
Compulsory instead of Elective (3).

Titles and credits wrap onto their own lines, so a course is accumulated until
the next code or category appears.

Prints TSV so it can be checked against the handbook before it goes anywhere
near the database.
"""
import re, sys

TEXT = r"E:\PES\handbook_text.txt"

DEPARTMENTS = [
    (811,  "Civil Engineering"),
    (1153, "Computer Engineering"),
    (1490, "Electrical and Electronic Engineering"),
    (1846, "Mechanical Engineering"),
]

lines = open(TEXT, encoding="utf8").read().split("\n")

# "CO4351", and the handbook's one paired code: "IS3173/ IS3174"
CODE = re.compile(r"^([A-Z]{2}\d{4})\s*(/\s*)?(.*)$")
CATEGORY = re.compile(r"(Compulsory|Optional|Electives?\s*\(\s*[\d/]+\s*\)|Electives?)", re.I)
BRACKET  = re.compile(r"^\(\s*([\d/]+)\s*\)\s*$")
GPA = re.compile(r"\b(Yes|No)\b", re.I)
SKIP = re.compile(r"^(Course|Code|Title|Credit|Value|Category|Contributing|to GPA)\b")


def blocks():
    marks = [(i, int(m.group(1)))
             for i, l in enumerate(lines)
             for m in [re.match(r"^Semester ([1-8])\s*$", l.strip())] if m]
    for idx, (line_no, sem) in enumerate(marks):
        end = marks[idx + 1][0] if idx + 1 < len(marks) else len(lines)
        dept = "COMMON" if line_no < DEPARTMENTS[0][0] else None
        if dept is None:
            for start, name in DEPARTMENTS:
                if line_no > start:
                    dept = name
        yield dept, sem, line_no + 1, min(end, line_no + 120)


def tokenise(start, end):
    """Course entries in order, with category cells marked where they fall."""
    items = []          # {"kind": "course"|"category", ...}
    for raw in lines[start:end]:
        line = raw.strip()
        if not line or SKIP.match(line):
            continue
        # Page numbers sit on their own line. Credit values do too, but no
        # course in this handbook is worth ten credits, so the two separate
        # cleanly on magnitude.
        if line.isdigit() and int(line) >= 10:
            continue
        # The letter-spaced page footer marks the end of the table.
        if "P r o s p e r" in line or line.count("  ") > 6:
            break
        if re.match(r"^Semester [1-8]", line) or line.startswith("DEPARTMENT"):
            break
        # Past the end of the table: the next department's prose runs long.
        if len(line) > 120:
            break

        # "Elective" and "(1/0)" arrive on separate lines in one table, and
        # the Yes/No can land on a third. Fold all of it back into the cell.
        br = BRACKET.match(GPA.sub("", line).strip())
        if (br and items and items[-1]["kind"] == "category"
                and items[-1]["label"].strip().lower() in ("elective", "electives")):
            items[-1]["label"] = f"Elective ({br.group(1)})"
            g = GPA.search(line)
            if g:
                items[-1]["gpa"] = g
            continue
        # A bare Yes/No on its own line, still settling the cell above it.
        if (items and items[-1]["kind"] == "category"
                and items[-1]["gpa"] is None and GPA.fullmatch(line)):
            items[-1]["gpa"] = GPA.search(line)
            continue

        cat = CATEGORY.search(line)
        code = CODE.match(line)

        if code:
            rest = (code.group(3) or "")
            # "IS3173/ IS3174 Sinhala/Tamil 1" on one line
            paired = None
            second = re.match(r"^\s*([A-Z]{2}\d{4})\s*(.*)$", rest)
            if code.group(2) and second:
                paired, rest = second.group(1), second.group(2)
            # ... or split over two, "IS3173/" then "IS3174"
            if (items and items[-1]["kind"] == "course"
                    and items[-1]["trailing_slash"]
                    and not items[-1]["text"].strip()):
                items[-1]["paired"] = code.group(1)
                items[-1]["trailing_slash"] = False
                items[-1]["text"] += " " + rest
                continue
            items.append({"kind": "course", "code": code.group(1),
                          "paired": paired, "text": rest,
                          "trailing_slash": bool(code.group(2)) and not paired})
            if cat:
                items.append({"kind": "category", "label": cat.group(0),
                              "gpa": (GPA.search(line[cat.end():]) or
                                      GPA.search(line))})
        elif cat:
            # The credit value often shares this line: "2 Compulsory". Give it
            # back to the course before the category cell is recorded.
            leftover = GPA.sub("", CATEGORY.sub("", line)).strip()
            if leftover and items and items[-1]["kind"] == "course":
                items[-1]["text"] += " " + leftover
            items.append({"kind": "category", "label": cat.group(0),
                          "gpa": GPA.search(line)})
        elif items and items[-1]["kind"] == "course":
            # a title or credit value that wrapped onto its own line
            items[-1]["text"] += " " + line
    return items


def finish(course):
    text = CATEGORY.sub("", course["text"])
    text = GPA.sub("", text)
    nums = re.findall(r"(?<!\d)(\d{1,2})(?!\d)", text)
    credits = int(nums[-1]) if nums else None
    if nums:
        text = text[: text.rfind(nums[-1])]
    title = re.sub(r"\s+", " ", text).strip(" -/\u2013")
    code = course["code"] + ("/" + course["paired"] if course["paired"] else "")
    return code, title, credits


def parse(dept, sem, start, end):
    items = tokenise(start, end)

    # A category cell opens a group at the course it attaches to: the course
    # on its own line, which tokenise emitted immediately before it.
    groups = []            # (index_of_first_course, label, gpa)
    courses = []
    for it in items:
        if it["kind"] == "course":
            courses.append(it)
        else:
            opens_at = max(0, len(courses) - 1)
            groups.append((opens_at, it["label"], it["gpa"]))

    rows = []
    for i, c in enumerate(courses):
        label, gpa = None, None
        for opens_at, lab, g in groups:
            if opens_at <= i:
                label, gpa = lab, (g.group(1) if g else gpa)
            else:
                break
        code, title, credits = finish(c)
        rows.append((dept, sem, code, title, credits,
                     re.sub(r"Electives?\s*\(\s*([\d/]+)\s*\)", "Elective (\\g<1>)",
                            re.sub(r"\s+", " ", label or "").strip()), gpa))
    return rows


out = []
for dept, sem, s, e in blocks():
    out += parse(dept, sem, s, e)

print("dept\tsem\tcode\ttitle\tcredits\tcategory\tgpa")
for r in out:
    print("\t".join("" if v is None else str(v) for v in r))
print(f"# {len(out)} rows", file=sys.stderr)
