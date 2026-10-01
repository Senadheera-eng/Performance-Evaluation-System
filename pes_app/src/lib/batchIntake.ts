/**
 * The spreadsheets a batch comes in and goes out with.
 *
 * A new intake reaches the faculty as a list from the admissions office, not
 * as a form typed one student at a time, so the Super Admin uploads it: one
 * row per student with their name and registration number, and optionally
 * their index number, email and department. Columns are found by their
 * headings, so a sheet with its own extra columns or a different order still
 * reads. Every row is checked here, before anything is created, and the page
 * shows what is wrong with which row.
 *
 * Going the other way, the temporary passwords of a new intake come back as a
 * sheet to hand out, and a batch about to be removed can be kept as a
 * workbook of its students, results, enrolments and attendance.
 */
import { DEPARTMENTS } from "./departments";
import { saveBlob } from "./resultsWorkbook";

export { saveBlob };

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The departments a student can belong to: the four engineering ones. */
export const STUDENT_DEPARTMENTS = [
  DEPARTMENTS.ce.name,
  DEPARTMENTS.co.name,
  DEPARTMENTS.ee.name,
  DEPARTMENTS.me.name,
];

/** The faculty email a student's registration number gives them. */
export const facultyEmail = (reg: string) => `en${reg.trim().toLowerCase()}@foe.sjp.ac.lk`;

export interface IntakeStudent {
  /** The row in the uploaded sheet, for pointing at it. */
  row: number;
  name: string;
  reg_number: string;
  index_number: string | null;
  email: string;
  department: string | null;
  /** Why this row cannot be added, if it cannot. */
  issue: string | null;
}

export interface ParsedSheet<T> {
  rows: T[];
  /** A problem with the file as a whole: no usable sheet, no headings. */
  fatal: string | null;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** Headings each column may carry, compared without case or punctuation. */
const COLUMNS = {
  name: ["name", "fullname", "studentname", "nameofstudent", "namewithinitials"],
  reg: ["registrationno", "registrationnumber", "regno", "regnumber", "registration", "reg"],
  index: ["indexno", "indexnumber", "index"],
  email: ["email", "emailaddress", "facultyemail", "mail"],
  department: ["department", "dept", "field"],
} as const;
type Column = keyof typeof COLUMNS;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((t) => t.text ?? "").join("").trim();
    }
    if ("result" in v) return cellText(v.result);
    if ("text" in v) return cellText(v.text);
    if ("hyperlink" in v) return cellText(v.hyperlink).replace(/^mailto:/i, "");
    if ("error" in v) return "";
  }
  return String(value).trim();
}

/** A CSV line split into fields, honouring quotes. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Every row of the first sheet that has anything in it, as text. */
async function readGrid(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    const text = (await file.text()).replace(/^﻿/, "");
    return text.split(/\r?\n/).map(csvFields);
  }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets.find((w) => w.rowCount > 0);
  if (!ws) return [];
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      cells[c - 1] = cellText(cell.value);
    });
    grid[n - 1] = Array.from(cells, (c) => c ?? "");
  });
  return Array.from(grid, (r) => r ?? []);
}

/** Finds the heading row among the first few and where each column is. */
function findColumns(grid: string[][], need: Column[]) {
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const at: Partial<Record<Column, number>> = {};
    grid[r].forEach((cell, c) => {
      const key = squash(cell);
      for (const col of Object.keys(COLUMNS) as Column[]) {
        if (at[col] === undefined && (COLUMNS[col] as readonly string[]).includes(key)) at[col] = c;
      }
    });
    if (need.every((col) => at[col] !== undefined)) return { headerRow: r, at };
  }
  return null;
}

/** A department as people write it: full name, code, or short name. */
export function matchDepartment(raw: string): string | null | undefined {
  const s = squash(raw);
  if (!s) return null;
  for (const name of STUDENT_DEPARTMENTS) {
    const dept = Object.values(DEPARTMENTS).find((d) => d.name === name)!;
    if (
      s === squash(name) ||
      s === dept.code.toLowerCase() ||
      s === squash(name.replace(/ Engineering$/, "")) ||
      (dept.code === "EE" && (s === "electrical" || s === "eee"))
    ) {
      return name;
    }
  }
  return undefined;
}

/**
 * A new intake's list, read and checked. `existing` holds the registration
 * numbers and emails already in PES, so a student added twice is caught
 * here rather than half-way through creating accounts.
 */
export async function parseIntakeFile(
  file: File,
  existing: { regs: Set<string>; emails: Set<string> },
): Promise<ParsedSheet<IntakeStudent>> {
  let grid: string[][];
  try {
    grid = await readGrid(file);
  } catch {
    return { rows: [], fatal: "This file could not be read. Upload the template as .xlsx or .csv." };
  }
  const found = findColumns(grid, ["name", "reg"]);
  if (!found) {
    return {
      rows: [],
      fatal:
        'No "Name" and "Registration No" headings were found. Download the template and copy the list into it.',
    };
  }
  const { headerRow, at } = found;
  const get = (row: string[], col: Column) => (at[col] === undefined ? "" : (row[at[col]!] ?? "").trim());

  const seenRegs = new Set<string>();
  const seenEmails = new Set<string>();
  const rows: IntakeStudent[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.every((c) => !c?.trim())) continue;
    const name = get(row, "name").replace(/\s+/g, " ");
    // The template's example row, left in.
    if (/\(example\b/i.test(name)) continue;
    const reg = get(row, "reg").replace(/\s+/g, "");
    const index = get(row, "index").replace(/\s+/g, "").toUpperCase() || null;
    const email = (get(row, "email") || (reg ? facultyEmail(reg) : "")).toLowerCase();
    const deptRaw = get(row, "department");
    const department = matchDepartment(deptRaw);

    let issue: string | null = null;
    if (name.length < 3) issue = "No name";
    else if (!/^[A-Za-z0-9/-]{3,20}$/.test(reg)) issue = reg ? "Registration number is not valid" : "No registration number";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issue = "Email is not valid";
    else if (department === undefined) issue = `Unknown department "${deptRaw}"`;
    else if (seenRegs.has(reg)) issue = "Registration number is in the list twice";
    else if (seenEmails.has(email)) issue = "Email is in the list twice";
    else if (existing.regs.has(reg)) issue = "Already in PES";
    else if (existing.emails.has(email)) issue = "Email already belongs to someone in PES";
    seenRegs.add(reg);
    seenEmails.add(email);

    rows.push({
      row: r + 1,
      name,
      reg_number: reg,
      index_number: index,
      email,
      department: department ?? null,
      issue,
    });
  }
  return {
    rows,
    fatal: rows.length === 0 ? "The file has headings but no students under them." : null,
  };
}

export interface DepartmentAssignment {
  row: number;
  reg_number: string;
  department: string | null;
  issue: string | null;
}

/** The faculty's division of a batch into departments: reg number and department. */
export async function parseDepartmentsFile(file: File): Promise<ParsedSheet<DepartmentAssignment>> {
  let grid: string[][];
  try {
    grid = await readGrid(file);
  } catch {
    return { rows: [], fatal: "This file could not be read. Upload it as .xlsx or .csv." };
  }
  const found = findColumns(grid, ["reg", "department"]);
  if (!found) {
    return { rows: [], fatal: 'No "Registration No" and "Department" headings were found.' };
  }
  const { headerRow, at } = found;
  const rows: DepartmentAssignment[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.every((c) => !c?.trim())) continue;
    const reg = (row[at.reg!] ?? "").replace(/\s+/g, "");
    const raw = (row[at.department!] ?? "").trim();
    const department = matchDepartment(raw);
    rows.push({
      row: r + 1,
      reg_number: reg,
      department: department ?? null,
      issue: !reg
        ? "No registration number"
        : department === undefined
          ? `Unknown department "${raw}"`
          : department === null
            ? "No department"
            : null,
    });
  }
  return { rows, fatal: rows.length === 0 ? "The file has headings but no rows under them." : null };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

type Workbook = import("exceljs").Workbook;
type Worksheet = import("exceljs").Worksheet;

async function newWorkbook(): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "PES — Faculty of Engineering, USJ";
  wb.created = new Date();
  return wb;
}

/**
 * Widens each column to its longest entry, so a full name -- the faculty
 * records four or five names for many students -- shows without being cut
 * off. A column never shrinks below the width it was given.
 */
export function fitColumns(ws: Worksheet, max = 80): void {
  ws.columns.forEach((column) => {
    let longest = 0;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      longest = Math.max(longest, cellText(cell.value).length);
    });
    column.width = Math.min(max, Math.max(column.width ?? 10, longest + 2));
  });
}

/** A sheet with a bold, frozen heading row and columns sized to fit. */
function addTable(
  wb: Workbook,
  name: string,
  columns: { header: string; key: string; width: number }[],
  rows: Record<string, unknown>[],
): Worksheet {
  const ws = wb.addWorksheet(name);
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF5" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  rows.forEach((r) => ws.addRow(r));
  fitColumns(ws);
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  return ws;
}

async function toBlob(wb: Workbook): Promise<Blob> {
  return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE });
}

/** The blank list to fill in, with one example row and a note on each column. */
export async function buildIntakeTemplate(batchLabel: string): Promise<Blob> {
  const wb = await newWorkbook();
  const ws = addTable(
    wb,
    "Students",
    [
      { header: "Name", key: "name", width: 34 },
      { header: "Registration No", key: "reg", width: 18 },
      { header: "Index No", key: "index", width: 16 },
      { header: "Email", key: "email", width: 30 },
      { header: "Department", key: "department", width: 36 },
    ],
    [{ name: "A.B.C. Perera (example — delete this row)", reg: "112345", index: "25/ENG/001", email: "", department: "" }],
  );
  ws.getRow(2).font = { italic: true, color: { argb: "FF888888" } };

  const notes = wb.addWorksheet("How to fill");
  notes.columns = [{ width: 22 }, { width: 90 }];
  [
    ["Intake", batchLabel],
    ["Name", "Required. The student's name as the faculty records it."],
    ["Registration No", "Required. Their university registration number, e.g. 112345. It must not already be in PES."],
    ["Index No", "Optional. e.g. 25/ENG/001."],
    ["Email", "Optional. Left blank, it is en<registration no>@foe.sjp.ac.lk — the address they sign in with."],
    [
      "Department",
      "Optional. A first-year is not in a department yet; leave it blank and record the division later from the Batches page. " +
        "Otherwise one of: " + STUDENT_DEPARTMENTS.join(", ") + " (or CE, CO, EE, ME).",
    ],
    ["Passwords", "PES makes a temporary password for every student and gives you a sheet of them. Each student changes theirs at first sign-in."],
  ].forEach(([a, b]) => {
    const row = notes.addRow([a, b]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });
  return toBlob(wb);
}

export interface CreatedStudent {
  name: string;
  reg_number: string;
  index_number?: string | null;
  email: string;
  department?: string | null;
  password: string;
}

/** The temporary passwords, to hand out. Kept nowhere else. */
export async function buildCredentialsWorkbook(batchLabel: string, students: CreatedStudent[]): Promise<Blob> {
  const wb = await newWorkbook();
  const ws = addTable(
    wb,
    "Sign-in details",
    [
      { header: "Index No", key: "index", width: 14 },
      { header: "Registration No", key: "reg", width: 16 },
      { header: "Name", key: "name", width: 34 },
      { header: "Email (sign-in)", key: "email", width: 30 },
      { header: "Temporary password", key: "password", width: 20 },
      { header: "Department", key: "department", width: 30 },
    ],
    [...students]
      .sort((a, b) => (a.index_number ?? a.reg_number).localeCompare(b.index_number ?? b.reg_number))
      .map((s) => ({
        index: s.index_number ?? "",
        reg: s.reg_number,
        name: s.name,
        email: s.email,
        password: s.password,
        department: s.department ?? "",
      })),
  );
  ws.getColumn("password").font = { name: "Consolas" };
  ws.headerFooter.oddHeader = `&L${batchLabel} — PES sign-in details&RConfidential`;
  return toBlob(wb);
}

export interface BatchRecords {
  students: Record<string, unknown>[];
  results: Record<string, unknown>[];
  enrollments: Record<string, unknown>[];
  attendance: Record<string, unknown>[];
}

/** A batch's records, kept as a workbook before the batch is removed. */
export async function buildBatchArchive(records: BatchRecords): Promise<Blob> {
  const wb = await newWorkbook();
  addTable(
    wb,
    "Students",
    [
      { header: "Index No", key: "index_number", width: 14 },
      { header: "Registration No", key: "reg_number", width: 16 },
      { header: "Name", key: "name", width: 34 },
      { header: "Email", key: "email", width: 30 },
      { header: "Department", key: "department", width: 34 },
      { header: "Status", key: "status", width: 12 },
    ],
    records.students,
  );
  addTable(
    wb,
    "Results",
    [
      { header: "Index No", key: "index_number", width: 14 },
      { header: "Registration No", key: "reg_number", width: 16 },
      { header: "Name", key: "name", width: 30 },
      { header: "Course", key: "course_code", width: 10 },
      { header: "Title", key: "course_title", width: 40 },
      { header: "Semester", key: "semester", width: 9 },
      { header: "Credits", key: "credits", width: 8 },
      { header: "Academic year", key: "academic_year", width: 14 },
      { header: "Grade", key: "grade", width: 7 },
      { header: "Grade point", key: "grade_point", width: 11 },
      { header: "Published", key: "published", width: 10 },
    ],
    records.results,
  );
  addTable(
    wb,
    "Enrolments",
    [
      { header: "Index No", key: "index_number", width: 14 },
      { header: "Registration No", key: "reg_number", width: 16 },
      { header: "Course", key: "course_code", width: 10 },
      { header: "Semester", key: "semester", width: 9 },
      { header: "Academic year", key: "academic_year", width: 14 },
      { header: "Status", key: "status", width: 12 },
      { header: "Kind", key: "kind", width: 12 },
    ],
    records.enrollments,
  );
  addTable(
    wb,
    "Attendance",
    [
      { header: "Index No", key: "index_number", width: 14 },
      { header: "Registration No", key: "reg_number", width: 16 },
      { header: "Course", key: "course_code", width: 10 },
      { header: "Date", key: "date", width: 12 },
      { header: "Status", key: "status", width: 10 },
    ],
    records.attendance,
  );
  return toBlob(wb);
}

/** "Batch 11 (2025-2026)" as a file name part. */
export const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
