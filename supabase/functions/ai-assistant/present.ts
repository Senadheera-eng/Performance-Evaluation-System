// Answers written by code, not by the model -- for a small model only.
//
// A 3B model on a CPU, asked for a semester's results, has to copy eight
// rows of codes, credits and grades out of the tool's result into a table,
// at a few tokens a second. It is slow at that, and it gets details wrong:
// in testing it gave a course the wrong number of credits. The data is
// already exact, so for the lookups that are lists -- results, attendance,
// course lists, outstanding modules -- the table is laid out here instead.
// The model still decides what the student is asking and which lookup
// answers it; it no longer retypes the answer.
//
// The same applies to sources: a small model rarely cites the handbook page
// or links the website page it used, so the pages its searches returned are
// listed under its answer.
//
// Used only for LOCAL_LLM_PROFILE=small. Gemini and large local models write
// their own answers, as before. Nothing here uses Deno APIs.

// deno-lint-ignore no-explicit-any
type Json = any;

const num = (v: unknown, digits = 2) =>
  typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(digits)) : v == null ? "—" : String(v);

const cell = (v: unknown) => String(v ?? "—").replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "—";

function table(headers: string[], rows: unknown[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

function results(args: Json, r: Json): string | null {
  if (!r || !Array.isArray(r.results)) return null;
  const which = [
    r.semester ? `Semester ${r.semester}` : null,
    r.course_search ? `"${r.course_search}"` : null,
  ].filter(Boolean).join(", ");
  if (r.results.length === 0) {
    return `You have no published results${which ? ` for ${which}` : ""} yet.`;
  }
  const several = new Set(r.results.map((x: Json) => x.semester)).size > 1;
  const rows = r.results.map((x: Json) => [
    ...(several ? [x.semester] : []),
    x.course_code,
    x.title,
    x.credits,
    x.grade,
  ]);
  const gpa = typeof r.gpa === "number"
    ? ` Your ${r.semester ? `Semester ${r.semester} ` : ""}GPA is **${num(r.gpa)}**${r.gpa_credits ? ` over ${r.gpa_credits} credits` : ""}.`
    : "";
  return [
    `Your published results${which ? ` for ${which}` : ""}:${gpa}`,
    "",
    table([...(several ? ["Sem"] : []), "Code", "Course", "Credits", "Grade"], rows),
  ].join("\n");
}

function attendance(_args: Json, a: Json): string | null {
  if (!a || typeof a !== "object") return null;
  const courses: Json[] = Array.isArray(a.by_course) ? a.by_course.filter((c: Json) => c.lectures > 0) : [];
  if (!a.lectures_recorded || courses.length === 0) {
    return "No lectures have been recorded for you yet, so there is no attendance to report.";
  }
  const min = Number(a.threshold_percent ?? 80);
  const warn = Number(a.prewarning_percent ?? min + 5);
  const below = courses.filter((c) => typeof c.percentage === "number" && c.percentage < min);
  const near = courses.filter((c) => typeof c.percentage === "number" && c.percentage >= min && c.percentage < warn);
  const flag = (p: unknown) =>
    typeof p !== "number" ? "" : p < min ? " ⚠️ below minimum" : p < warn ? " · close to the minimum" : "";
  const summary = [
    `Your overall attendance is **${num(a.overall_percentage, 1)}%** across ${a.lectures_recorded} recorded lectures (the minimum is ${min}%).`,
    below.length
      ? `**Below the minimum:** ${below.map((c) => c.course_code).join(", ")}.`
      : near.length
        ? `Close to the minimum: ${near.map((c) => c.course_code).join(", ")}.`
        : "Every course is above the minimum.",
  ].join(" ");
  return [
    summary,
    "",
    table(
      ["Code", "Course", "Attended", "Lectures", "%"],
      courses.map((c) => [
        c.course_code,
        c.title,
        (c.present ?? 0) + (c.excused ?? 0),
        c.lectures,
        `${num(c.percentage, 1)}${flag(c.percentage)}`,
      ]),
    ),
    "",
    "Excused absences count as attended.",
  ].join("\n");
}

function courseList(heading: (r: Json) => string) {
  return (_args: Json, r: Json): string | null => {
    if (!r || !Array.isArray(r.courses)) return null;
    if (r.courses.length === 0) return `${heading(r)}: none found.`;
    return [
      `${heading(r)}:`,
      "",
      table(
        ["Code", "Course", "Credits", "Category"],
        r.courses.map((c: Json) => [c.code ?? c.course_code, c.title, c.credits, c.minor_category ?? c.category]),
      ),
    ].join("\n");
  };
}

function outstanding(_args: Json, r: Json): string | null {
  const list: Json[] | null = Array.isArray(r?.outstanding) ? r.outstanding : Array.isArray(r) ? r : null;
  if (!list) return null;
  if (list.length === 0) return "You have no outstanding modules — nothing to repeat or re-sit.";
  return [
    `You have ${list.length} outstanding module${list.length === 1 ? "" : "s"} to take again:`,
    "",
    table(
      ["Code", "Course", "Semester", "Credits", "Grade"],
      list.map((m) => [m.course_code, m.title, m.semester, m.credits, m.outstanding]),
    ),
    "",
    "Enrol in them on the **Enrollment** page when the window opens.",
  ].join("\n");
}

const PRESENTERS: Record<string, (args: Json, result: Json) => string | null> = {
  get_student_results: results,
  get_my_attendance: attendance,
  get_courses_by_semester: courseList((r) => `Semester ${r.semester} courses${r.department ? ` in ${r.department}` : ""}`),
  get_upcoming_courses: courseList((r) => `Your next semester${r.next_semester ? ` (Semester ${r.next_semester})` : ""}`),
  my_outstanding_modules: outstanding,
};

/** The answer to one lookup, written from its result -- or null to let the model write it. */
export function presentResult(name: string, args: Record<string, unknown>, result: unknown): string | null {
  const present = PRESENTERS[name];
  if (!present || result == null || (typeof result === "object" && "error" in (result as Json))) return null;
  try {
    return present(args, result);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Search results, made readable for a small model                     */
/* ------------------------------------------------------------------ */

const CALENDAR_CODES: Record<string, string> = {
  E: "Exams",
  S: "Study break",
  MB: "Mid-semester break",
  V: "Vacation",
  NV: "New Year vacation",
  CV: "Christmas vacation",
  IT: "Industrial training",
  SC: "Survey camp",
};

/* "Batch 07" and "22ENG" are the same intake: Batch N entered in 2015+N. */
function batchLabel(raw: string): string {
  const b = raw.match(/^Batch\s*0?(\d+)$/i);
  if (b) return `Batch ${b[1].padStart(2, "0")} (${Number(b[1]) + 15}ENG)`;
  const e = raw.match(/^(\d{2})ENG$/i);
  if (e) return `Batch ${String(Number(e[1]) - 15).padStart(2, "0")} (${e[1]}ENG)`;
  return raw;
}

/*
  The academic calendar, as the faculty publishes it, is a grid of codes: a
  legend, then per batch a run of "7 (29-Dec-2025); 8 (5-Jan-2026); ... E
  (9-Mar-2026 to 16-Mar-2026)". A large model reads that; a 3B model picked
  another batch's dates in testing. Here every batch becomes one plain line
  of what happens when -- the semester weeks, which nobody asks about, left
  out.
*/
function readableCalendar(content: string): string | null {
  const byBatch = new Map<string, string[]>();
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*(Batch\s*\d+|\d{2}ENG)\s*:\s*(.+)$/i);
    if (!m) continue;
    const label = batchLabel(m[1].trim());
    const events = byBatch.get(label) ?? [];
    for (const e of m[2].matchAll(/([A-Z]{1,2}\d?|\d{1,2})\s*\(([^)]+)\)/g)) {
      const code = e[1];
      if (/^\d+$/.test(code)) continue; // a week of the semester
      const what = /^S\d$/.test(code) ? `Semester ${code.slice(1)}` : CALENDAR_CODES[code] ?? code;
      events.push(`${what}: ${e[2].includes(" to ") ? e[2] : `week of ${e[2]}`}`);
    }
    byBatch.set(label, events);
  }
  if (byBatch.size === 0) return null;
  return [...byBatch].map(([batch, events]) => `${batch}: ${events.join("; ")}.`).join("\n");
}

/**
 * A tool's result as a small model is given it: search results cut to the
 * best few, long passages shortened, the academic calendar in plain words.
 */
export function simplifyForSmallModel(name: string, result: unknown): unknown {
  if (!Array.isArray(result)) return result;
  if (name === "search_handbook") {
    return result.slice(0, 3).map((r: Json) => ({
      page: r.page,
      section: r.section,
      text: String(r.content ?? "").slice(0, 700),
    }));
  }
  if (name === "search_faculty_website") {
    return result.slice(0, 3).map((r: Json) => {
      const calendar = /calend/i.test(`${r.url} ${r.title}`) ? readableCalendar(String(r.content ?? "")) : null;
      return {
        title: r.title,
        url: r.url,
        text: calendar ?? String(r.content ?? "").slice(0, 900),
      };
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Which lookup, for a small model                                     */
/* ------------------------------------------------------------------ */

/*
  A 1.7B model asked "Can I still get a CGPA of 3.7?" searched the handbook
  instead of calling calculate_gpa_target, and then told the student it was
  possible when it was not. Picking the lookup is where a small model goes
  wrong most dangerously, and the common questions are recognisable from
  their words. So the question carries a hint naming the likely lookup. It is
  only a hint: the model still decides, and a question none of these match
  gets none.
*/
const HINTS: [RegExp, string][] = [
  [/\b(?:[23]\.\d{1,2}|4\.0)\b.*\b(?:c?gpa|class)\b|\b(?:c?gpa|class)\b.*\b(?:[23]\.\d{1,2}|4\.0)\b|first class|second upper|second lower/i, "calculate_gpa_target (pass the target CGPA; First Class needs 3.70, Second Upper 3.30, Second Lower 3.00, Handbook p. 27)"],
  [/\b[A-Z]{2}\s?\d{4}\b.*\b(?:grade|result|mark|get|got)\b|\b(?:grade|result|mark|got)\b.*\b[A-Z]{2}\s?\d{4}\b/i, "get_student_course_result"],
  [/\b(?:my|semester|sem)\b.*\b(?:results?|grades?|marks)\b|\b(?:results?|grades?)\b.*\b(?:semester|sem)\s*\d/i, "get_student_results"],
  [/\b(?:my\s+)?(?:c?gpa|standing|class(?:ification)?|credits? (?:done|completed|left|remaining))\b/i, "get_academic_standing"],
  [/\battend/i, "get_my_attendance"],
  [/\b(?:repeat|re-?sit|outstanding|owe)\b.*\b(?:my|i|do i)\b|\b(?:my|i)\b.*\b(?:repeat|re-?sit|outstanding)\b/i, "my_outstanding_modules"],
  [/\bminor\b/i, "get_my_minor_progress"],
  [/\bmedical\b/i, "get_my_medical_submissions"],
  [/\b(?:exams?|calend[ae]r|vacation|holiday|semester (?:start|begin|end)s?|notice|deadline|dean\b|contact|phone|email|hostel|mahapola|convocation|transcript)/i, "search_faculty_website"],
  [/\b(?:fail|repeat|re-?sit|regulation|rule|honou?rs?|dean'?s list|graduat|industrial training|grading|gpv)\b/i, "search_handbook"],
];

/** The lookup a question most likely needs, as a hint for a small model -- or null. */
export function toolHint(message: string): string | null {
  for (const [pattern, tool] of HINTS) if (pattern.test(message)) return `Hint: this is probably answered by ${tool}.`;
  return null;
}

/** Where a search's answer came from, to list under the model's answer. */
export function sourcesOf(name: string, result: unknown): string[] {
  const rows: Json[] = Array.isArray(result) ? result : [];
  if (name === "search_handbook") {
    const pages = [...new Set(rows.slice(0, 3).map((r) => r.page).filter((p) => p != null))];
    return pages.length ? [`Faculty Handbook 2026, p. ${pages.join(", ")}`] : [];
  }
  if (name === "search_faculty_website") {
    const seen = new Set<string>();
    return rows
      .filter((r) => typeof r.url === "string" && !seen.has(r.url) && seen.add(r.url))
      .slice(0, 2)
      .map((r) => `[${cell(r.title || r.url)}](${r.url})`);
  }
  return [];
}
