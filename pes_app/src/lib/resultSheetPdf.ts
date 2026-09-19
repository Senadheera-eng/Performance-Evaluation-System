/**
 * Course-wise examination result sheet PDF, matching the faculty's own
 * official format — two variants, chosen from the actual data rather than
 * a manual flag:
 *
 *  - Format A (multi-department): the roster's regular candidates span more
 *    than one home department (shared/Interdisciplinary Studies courses).
 *    Modelled on the IS3151 "Technical Writing" sheet — one table per
 *    department, plus a single consolidated Repeat Candidates table.
 *  - Format B (single department): every regular candidate shares one home
 *    department. Modelled on the ME2302 "Fluid Dynamics" sheet — a header
 *    block naming credits/GPA contribution/coordinator/weightings, one
 *    results table, one Repeat Students table.
 *
 * Deliberate simplification from the source documents: the reference
 * sheets pair department tables (or the repeat table) side-by-side on the
 * page. jspdf-autotable has no native support for two independently
 * paginating tables that stay visually synced across page breaks, and
 * there is no way to preview a rendered PDF in this environment before it
 * reaches the admin — a hand-rolled pagination algorithm chasing that exact
 * layout would be shipped unverified. Every table here instead paginates
 * on its own, sequentially, with its own repeating header — identical
 * columns, grouping, and content, just stacked instead of paired.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getBatchNumber } from "./batch";

export interface ResultSheetRow {
  indexNumber: string;
  /** Already formatted (EN-prefixed) or the bare reg number — caller's choice. */
  regNumber: string;
  grade: string;
  department: string;
  isRepeat: boolean;
}

export interface ResultSheetMeta {
  courseCode: string;
  courseTitle: string;
  /** The course's own catalogue department (e.g. "Interdisciplinary Studies"). */
  courseDepartment: string;
  credits: number;
  contributesToGpa: boolean;
  semester: number;
  batchYear: number;
  academicYear: string;
  /** All optional — the reference sheets show these blank as often as not. */
  courseCoordinator?: string;
  caWeight?: number;
  eseWeight?: number;
  midSemWeight?: number;
  boardExamDate?: string;
}

const DISCLAIMER =
  "* Subjected to the approval of the Board of Examiners in the Faculty of Engineering and the Senate of the University of Sri Jayewardenepura.";

const NUMBER_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten",
];

const creditsInWords = (credits: number): string => {
  const whole = Math.round(credits);
  const word = NUMBER_WORDS[whole] ?? String(whole);
  return `${word} (${credits.toFixed(1)})`;
};

const weightLabel = (w: number | undefined): string =>
  w === undefined || w === null ? "—" : w.toString();

/** Grouping order matches the reference sheet's own department ordering. */
const DEPARTMENT_ORDER = [
  "Civil Engineering",
  "Mechanical Engineering",
  "Computer Engineering",
  "Electrical and Electronic Engineering",
];
const DEPARTMENT_ABBR: Record<string, string> = {
  "Civil Engineering": "CE",
  "Mechanical Engineering": "ME",
  "Computer Engineering": "CO",
  "Electrical and Electronic Engineering": "EE",
  "Interdisciplinary Studies": "IS",
};

function groupByDepartment(
  rows: ResultSheetRow[],
): Array<{ department: string; rows: ResultSheetRow[] }> {
  const byDept = new Map<string, ResultSheetRow[]>();
  rows.forEach((r) => {
    const list = byDept.get(r.department) ?? [];
    list.push(r);
    byDept.set(r.department, list);
  });
  const known = DEPARTMENT_ORDER.filter((d) => byDept.has(d));
  const rest = [...byDept.keys()].filter((d) => !DEPARTMENT_ORDER.includes(d));
  return [...known, ...rest].map((department) => ({
    department,
    rows: byDept.get(department)!.sort((a, b) =>
      a.indexNumber.localeCompare(b.indexNumber),
    ),
  }));
}

const RESULT_COLUMNS = ["#", "Index No.", "Reg. No.", "Grade"];

function drawResultsTable(
  doc: jsPDF,
  startY: number,
  rows: ResultSheetRow[],
): number {
  autoTable(doc, {
    startY,
    head: [RESULT_COLUMNS],
    body: rows.map((r, i) => [
      String(i + 1),
      r.indexNumber,
      r.regNumber,
      r.grade,
    ]),
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 1.8,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
    },
    headStyles: {
      fillColor: [235, 235, 235],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      halign: "center",
    },
    tableWidth: "wrap",
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 32 },
      2: { cellWidth: 32 },
      3: { cellWidth: 24, halign: "center" },
    },
    margin: { left: 14, right: 14 },
  });
  return (doc as any).lastAutoTable.finalY;
}

function drawSectionHeading(doc: jsPDF, y: number, text: string): number {
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(text, 14, y);
  return y + 4;
}

function ensureRoom(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - 20) {
    doc.addPage();
    return 20;
  }
  return y;
}

const BANNER_TITLE = "FACULTY OF ENGINEERING - EXAMINATION RESULTS";

function drawTopBanner(doc: jsPDF, meta: ResultSheetMeta): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const batchLabel = `Batch ${String(getBatchNumber(meta.batchYear)).padStart(2, "0")}`;

  const left = 14;
  const right = pageWidth - 14;
  // Three short metadata cells get a fixed width; the title gets whatever's
  // left. Font size backs off automatically if it still wouldn't fit —
  // this cannot be verified visually ahead of time in this environment, so
  // it's made to fail safe rather than assumed correct from a fixed size.
  const cellWidth = 27;
  const div3 = right - 3 * cellWidth;
  const div2 = right - 2 * cellWidth;
  const div1 = right - 1 * cellWidth;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(left, 12, right - left, 10);
  doc.line(div3, 12, div3, 22);
  doc.line(div2, 12, div2, 22);
  doc.line(div1, 12, div1, 22);

  doc.setFont("helvetica", "bold");
  let titleSize = 11;
  const titleMaxWidth = div3 - left - 8;
  while (
    titleSize > 7 &&
    doc.getStringUnitWidth(BANNER_TITLE) * titleSize / doc.internal.scaleFactor > titleMaxWidth
  ) {
    titleSize -= 0.5;
  }
  doc.setFontSize(titleSize);
  doc.text(BANNER_TITLE, left + 4, 18.5);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(meta.academicYear, div3 + 4, 18.5);
  doc.text(batchLabel, div2 + 4, 18.5);
  doc.text(`Semester ${meta.semester}`, div1 + 4, 18.5);

  return 26;
}

function drawFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(`Page ${p} of ${pages}`, pageWidth - 20, pageHeight - 8);
  }
}

function drawDisclaimer(doc: jsPDF, y: number): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text(DISCLAIMER, 14, y, { maxWidth: pageWidth - 28 });
}

export function buildResultSheetPdf(
  meta: ResultSheetMeta,
  allRows: ResultSheetRow[],
): jsPDF {
  const doc = new jsPDF();
  const regular = allRows.filter((r) => !r.isRepeat);
  const repeats = allRows.filter((r) => r.isRepeat);
  const departments = groupByDepartment(regular);
  const isMultiDepartment = departments.length > 1;

  let y = drawTopBanner(doc, meta);

  if (isMultiDepartment) {
    autoTable(doc, {
      startY: y,
      body: [
        ["Course Code", meta.courseCode],
        ["Course Title", meta.courseTitle],
        ["Department", meta.courseDepartment],
        ["Date of Board of Examination", meta.boardExamDate ?? ""],
      ],
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 1.8, lineColor: [0, 0, 0], lineWidth: 0.2 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    departments.forEach(({ department, rows }) => {
      y = ensureRoom(doc, y, 20);
      const abbr = DEPARTMENT_ABBR[department] ?? department;
      y = drawSectionHeading(doc, y, `${abbr} — ${department} (${rows.length})`);
      y = drawResultsTable(doc, y, rows) + 6;
    });

    if (repeats.length > 0) {
      y = ensureRoom(doc, y, 20);
      y = drawSectionHeading(doc, y, `Repeat Candidates (${repeats.length})`);
      y = drawResultsTable(doc, y, repeats) + 6;
    }
  } else {
    autoTable(doc, {
      startY: y,
      body: [
        ["Course Code", meta.courseCode],
        ["Course Title", meta.courseTitle],
        ["Number of Credits", creditsInWords(meta.credits)],
        ["Contributing to GPA", meta.contributesToGpa ? "Yes" : "No"],
        ["Department", meta.courseDepartment],
        ["Course Coordinator", meta.courseCoordinator ?? ""],
        ["CA Weightage", weightLabel(meta.caWeight)],
        ["ESE Weightage", weightLabel(meta.eseWeight)],
        ...(meta.midSemWeight !== undefined
          ? [["Mid Sem Weightage", weightLabel(meta.midSemWeight)]]
          : []),
        ["Date of Board of Examination", meta.boardExamDate ?? ""],
      ],
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 1.8, lineColor: [0, 0, 0], lineWidth: 0.2 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    y = drawSectionHeading(doc, y, `Results (${regular.length})`);
    y = drawResultsTable(doc, y, regular) + 6;

    if (repeats.length > 0) {
      y = ensureRoom(doc, y, 20);
      y = drawSectionHeading(doc, y, `Repeat Students (${repeats.length})`);
      y = drawResultsTable(doc, y, repeats) + 6;
    }
  }

  y = ensureRoom(doc, y, 15);
  drawDisclaimer(doc, y + 4);
  drawFooter(doc);

  return doc;
}

export function buildResultSheetFilename(meta: ResultSheetMeta): string {
  const batchLabel = String(getBatchNumber(meta.batchYear)).padStart(2, "0");
  const [y1, y2] = meta.academicYear.split("/");
  const yearLabel = y2 ? `${y1}-${y2.slice(2)}` : meta.academicYear;
  return `${meta.courseCode}_Batch_${batchLabel}_Semester_${meta.semester}_${yearLabel}_Results.pdf`;
}
