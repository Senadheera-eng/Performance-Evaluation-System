/**
 * The results spreadsheet: the one that goes out, and the one that comes back.
 *
 * A department of forty students is not typed into a web form one box at a
 * time, so the sheet leaves as .xlsx with the class list already in it and
 * comes back with marks against those names. Everything here exists because
 * the file spends the trip outside our control: rows get sorted, columns get
 * inserted, someone opens last term's copy, someone pastes a name in place of
 * an index number. None of that may reach the results table.
 *
 * Two rules carry the whole design.
 *
 * The file names the sheet it belongs to, in a cell, so one downloaded for one
 * course cannot be uploaded against another — the commonest and most damaging
 * mistake, because every other column would still look plausible.
 *
 * And the index number is the identity, not the row position. Sorting the
 * sheet, deleting a row, or adding one changes nothing: each row is matched
 * back to the roster by what it says it is.
 *
 * Nothing here writes to the database. A parsed file produces a report the
 * person reviews, and only what they accept is put into the on-screen sheet,
 * which they then save and submit as if they had typed it.
 */

/** Column headers, in order. The parser finds these rather than trusting
 *  position, so an extra column someone added on the left is survivable. */
const HEADERS = [
  "Index Number",
  "Registration Number",
  "Name",
  "Mid-Sem",
  "CA",
  "Grade",
] as const;

/** The cell that says which sheet this file is for. */
const SHEET_KEY_LABEL = "Sheet Key";

const SHEET_NAME = "Results";

/** Faculty maxima for the two components that are still entered. */
export const MARK_MAX = { midSem: 50, ca: 50 } as const;

export interface SheetMeta {
  /** Identifies the exact sheet this file belongs to: the offering for a
   *  lecturer, the course-and-year pairing for an admin. Whatever it is, a
   *  file carrying a different one is somebody else's class. */
  sheetKey: string;
  courseCode: string;
  courseTitle: string;
  batchLabel: string;
  academicYear: string;
}

export interface SheetStudent {
  studentId: string;
  indexNumber: string;
  regNumber: string;
  name: string;
  midSem: string;
  ca: string;
  grade: string;
  /** Submitted or published: exported so the file is a complete record, but
   *  refused on the way back in, because the database will refuse it too. */
  locked: boolean;
}

export interface ImportRow {
  /** 1-based row in the spreadsheet, so a person can go and look at it. */
  excelRow: number;
  indexNumber: string;
  name: string;
  studentId: string | null;
  midSem: string;
  ca: string;
  grade: string;
  problems: string[];
}

export interface ImportReport {
  fileName: string;
  /** Set when the file cannot be used at all; everything else is then empty. */
  fatal: string | null;
  /** Rows that can be applied. Some may carry a blank mark or grade — that is
   *  an incomplete row, not a wrong one, and submission will catch it. */
  ready: ImportRow[];
  /** Rows with something wrong. Never applied. */
  rejected: ImportRow[];
  /** Rows for students whose marks are already submitted or published. */
  locked: ImportRow[];
  /** Students on the roster that the file said nothing about. */
  absent: string[];
  /** Rows that carry no marks at all — counted, not complained about. */
  blankCount: number;
}

/* ------------------------------------------------------------------ */
/* Reading cells                                                       */
/* ------------------------------------------------------------------ */

/**
 * Whatever a cell holds, as trimmed text.
 *
 * ExcelJS hands back a number, a string, a rich-text object, a hyperlink
 * object or a formula result depending on how the cell was produced, and a
 * mark typed into a formatted column arrives as none of the ones you expect.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[])
        .map((t) => t.text ?? "")
        .join("")
        .trim();
    }
    if ("result" in v) return cellText(v.result);
    if ("text" in v) return cellText(v.text);
    if ("error" in v) return "";
  }
  return String(value).trim();
}

/** Index numbers differ only by punctuation and case when typed by hand. */
function normaliseIndex(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/[–—]/g, "-").toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Writing the template                                                */
/* ------------------------------------------------------------------ */

export async function buildResultsTemplate(
  meta: SheetMeta,
  students: SheetStudent[],
  validGrades: string[],
): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "PES — Faculty of Engineering, USJ";
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET_NAME);
  ws.columns = [
    { width: 16 },
    { width: 20 },
    { width: 34 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
  ];

  const label = (row: number, key: string, value: string) => {
    ws.getCell(`A${row}`).value = key;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`B${row}`).value = value;
  };

  label(1, "Course", `${meta.courseCode} — ${meta.courseTitle}`);
  label(2, "Batch", meta.batchLabel);
  label(3, "Academic Year", meta.academicYear);
  /* The anchor. Without it a file is not a PES template; with the wrong one
     it is somebody else's sheet, and we say so by name rather than importing
     forty marks against the wrong class. */
  label(4, SHEET_KEY_LABEL, meta.sheetKey);
  ws.getCell("C4").value = "← do not edit or delete this row";
  ws.getCell("C4").font = { italic: true, color: { argb: "FF888888" } };

  ws.getCell("A6").value =
    `Enter Mid-Sem and CA out of ${MARK_MAX.midSem} and ${MARK_MAX.ca}, and choose a Grade. ` +
    `The grade is yours to decide; it is not calculated from the marks.`;
  ws.getCell("A6").font = { italic: true, color: { argb: "FF555555" } };

  const headerRowNumber = 8;
  const headerRow = ws.getRow(headerRowNumber);
  headerRow.values = [...HEADERS];
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8B1E2D" },
    };
    cell.alignment = { vertical: "middle" };
  });
  headerRow.commit();

  students.forEach((s, i) => {
    const r = ws.getRow(headerRowNumber + 1 + i);
    r.values = [
      s.indexNumber,
      s.regNumber,
      s.name,
      s.midSem === "" ? null : Number(s.midSem),
      s.ca === "" ? null : Number(s.ca),
      s.grade,
    ];

    /* Excel's own guard rails, so most mistakes never leave the spreadsheet.
       They are a courtesy, not a control: the parser re-checks everything,
       because validation travels with the file only while Excel is open. */
    for (const col of ["D", "E"]) {
      const max = col === "D" ? MARK_MAX.midSem : MARK_MAX.ca;
      ws.getCell(`${col}${r.number}`).dataValidation = {
        type: "decimal",
        operator: "between",
        allowBlank: true,
        formulae: [0, max],
        showErrorMessage: true,
        errorTitle: "Out of range",
        error: `This mark is out of ${max}.`,
      };
    }
    ws.getCell(`F${r.number}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${validGrades.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Not a grade",
      error: `Choose one of: ${validGrades.join(", ")}`,
    };

    if (s.locked) {
      /* Already submitted or published. Shown so the sheet is a complete
         class list, greyed so nobody wastes time typing into it. */
      r.eachCell((cell) => {
        cell.font = { color: { argb: "FF999999" }, italic: true };
      });
    }
    r.commit();
  });

  ws.views = [{ state: "frozen", ySplit: headerRowNumber }];
  ws.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber + students.length, column: HEADERS.length },
  };

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Ask the browser to save a blob under a name. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoking immediately can cancel the download in some browsers. */
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function templateFileName(meta: SheetMeta): string {
  const safe = `${meta.courseCode}-${meta.batchLabel}`
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `PES-results-${safe}.xlsx`;
}

/* ------------------------------------------------------------------ */
/* Reading it back                                                     */
/* ------------------------------------------------------------------ */

function validateMark(
  label: string,
  raw: string,
  max: number,
): { value: string; problem?: string } {
  if (raw === "") return { value: "" };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { value: "", problem: `${label} "${raw}" is not a number` };
  if (n < 0 || n > max) return { value: "", problem: `${label} ${n} is outside 0–${max}` };
  return { value: String(n) };
}

export async function parseResultsWorkbook(
  file: File,
  meta: SheetMeta,
  roster: SheetStudent[],
  validGrades: string[],
): Promise<ImportReport> {
  const empty: ImportReport = {
    fileName: file.name,
    fatal: null,
    ready: [],
    rejected: [],
    locked: [],
    absent: [],
    blankCount: 0,
  };

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return { ...empty, fatal: "This file is not a readable .xlsx workbook." };
  }

  const ws = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) return { ...empty, fatal: "The workbook has no sheets in it." };

  /* Find the offering id and the header row by looking for them, so inserting
     a row at the top does not break the file. */
  let fileKey: string | null = null;
  let headerRowNumber = 0;
  let columnOf: Record<string, number> = {};

  ws.eachRow((row, rowNumber) => {
    if (headerRowNumber > 0) return;

    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col] = cellText(cell.value);
    });

    for (let c = 1; c < cells.length; c++) {
      if (cells[c] && cells[c].toLowerCase() === SHEET_KEY_LABEL.toLowerCase()) {
        fileKey = cellText(cells[c + 1] ?? "");
      }
    }

    const found: Record<string, number> = {};
    for (let c = 1; c < cells.length; c++) {
      const header = HEADERS.find(
        (h) => h.toLowerCase() === (cells[c] ?? "").toLowerCase(),
      );
      if (header) found[header] = c;
    }
    if (HEADERS.every((h) => found[h] !== undefined)) {
      headerRowNumber = rowNumber;
      columnOf = found;
    }
  });

  if (!fileKey) {
    return {
      ...empty,
      fatal:
        "This file has no Sheet Key row, so there is no way to tell which course it belongs to. Download a fresh template and enter marks into that.",
    };
  }
  if (fileKey !== meta.sheetKey) {
    return {
      ...empty,
      fatal: `This file was downloaded for a different course offering, so importing it would put marks against the wrong class. It is not the template for ${meta.courseCode} — ${meta.batchLabel}.`,
    };
  }
  if (headerRowNumber === 0) {
    return {
      ...empty,
      fatal: `The sheet has no header row. It needs a row containing: ${HEADERS.join(", ")}.`,
    };
  }

  const byIndex = new Map(roster.map((s) => [normaliseIndex(s.indexNumber), s]));
  const upperGrades = validGrades.map((g) => g.toUpperCase());

  const ready: ImportRow[] = [];
  const rejected: ImportRow[] = [];
  const locked: ImportRow[] = [];
  const seen = new Map<string, number>();
  const matched = new Set<string>();
  let blankCount = 0;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;

    const at = (h: (typeof HEADERS)[number]) =>
      cellText(row.getCell(columnOf[h]).value);

    const indexRaw = at("Index Number");
    const midRaw = at("Mid-Sem");
    const caRaw = at("CA");
    const gradeRaw = at("Grade");

    // A trailing empty row is how spreadsheets end; it is not a problem.
    if (!indexRaw && !midRaw && !caRaw && !gradeRaw) return;

    const problems: string[] = [];
    const key = normaliseIndex(indexRaw);
    const student = byIndex.get(key) ?? null;

    if (!indexRaw) {
      problems.push("No index number, so there is no way to tell whose marks these are");
    } else if (!student) {
      problems.push(`${indexRaw} is not on this course's class list`);
    } else {
      const firstSeen = seen.get(key);
      if (firstSeen !== undefined) {
        problems.push(`${indexRaw} already appears on row ${firstSeen}`);
      } else {
        seen.set(key, rowNumber);
      }
    }

    const mid = validateMark("Mid-Sem", midRaw, MARK_MAX.midSem);
    if (mid.problem) problems.push(mid.problem);
    const ca = validateMark("CA", caRaw, MARK_MAX.ca);
    if (ca.problem) problems.push(ca.problem);

    let grade = "";
    if (gradeRaw !== "") {
      const g = gradeRaw.toUpperCase();
      if (!upperGrades.includes(g)) {
        problems.push(
          `"${gradeRaw}" is not a grade this faculty awards (${validGrades.join(", ")})`,
        );
      } else {
        grade = g;
      }
    }

    const entry: ImportRow = {
      excelRow: rowNumber,
      indexNumber: indexRaw,
      name: student?.name ?? at("Name"),
      studentId: student?.studentId ?? null,
      midSem: mid.value,
      ca: ca.value,
      grade,
      problems,
    };

    if (problems.length > 0) {
      rejected.push(entry);
      return;
    }
    if (student!.locked) {
      matched.add(student!.studentId);
      /* The template exports locked rows with their marks already in them, so
         an untouched file hands every one of them straight back. Saying "3
         students are already published" on every single import would be noise
         about a no-op. Only a row someone actually changed is worth raising. */
      const changed =
        entry.midSem !== student!.midSem ||
        entry.ca !== student!.ca ||
        entry.grade !== student!.grade.toUpperCase();
      if (changed) locked.push(entry);
      return;
    }

    matched.add(student!.studentId);
    if (mid.value === "" && ca.value === "" && grade === "") blankCount++;
    ready.push(entry);
  });

  const absent = roster
    .filter((s) => !s.locked && !matched.has(s.studentId))
    .map((s) => `${s.indexNumber} — ${s.name}`);

  return { fileName: file.name, fatal: null, ready, rejected, locked, absent, blankCount };
}
