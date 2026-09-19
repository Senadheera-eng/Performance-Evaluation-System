import { supabase } from "./supabase";

export interface FeedbackPeriod {
  id: string;
  title: string;
  academic_year: string;
  semester: number;
  batch_year: number | null;
  opens_at: string;
  closes_at: string;
  status: "draft" | "scheduled" | "open" | "closed" | "archived";
  allow_editing: boolean;
}

export type FeedbackSubmissionStatus =
  | "pending"
  | "draft"
  | "submitted"
  | "closed";

export interface EligibleFeedbackCourse {
  course_id: string;
  course_code: string;
  title: string;
  credits: number;
  semester: number;
  category: string;
  department: string;
  lecturer_name: string | null;
  submission_status: FeedbackSubmissionStatus;
}

export type FeedbackQuestionType =
  | "rating"
  | "short_text"
  | "long_text"
  | "single_choice"
  | "multi_select"
  | "yes_no";

/** A named option on a single-choice question. */
export interface FeedbackOption {
  value: string;
  label: string;
}

export interface FeedbackQuestion {
  id: string;
  question_text: string;
  question_type: FeedbackQuestionType;
  category: string | null;
  display_order: number;
  is_required: boolean;
  options: FeedbackOption[] | null;
  /** Grey prompt inside a text box, as the faculty's form words it. */
  placeholder: string | null;
  /** 'course' is asked once; 'lecturer' once per lecturer on the offering. */
  target_type: "course" | "lecturer";
  section_key: string | null;
  section_title: string | null;
  /** Where this question's section sits on the student's form. */
  section_order: number;
  /** Set when this question only appears once another is answered a certain way. */
  depends_on_question_id: string | null;
  depends_on_values: string[] | null;
}

/** Questions grouped for display, in the order the form defines. */
export interface FeedbackSection {
  key: string;
  title: string;
  /** Subtitle under the heading, e.g. "Assignments, projects and lab work". */
  description: string | null;
  icon: string | null;
  target_type: "course" | "lecturer";
  questions: FeedbackQuestion[];
}

/**
 * One course a student can give feedback on right now, for one round.
 *
 * A course can appear twice — once for a mid-semester round and once for an
 * end-semester one — which is exactly the choice the faculty's form puts in
 * front of the student after they pick a course.
 */
export interface FeedbackCatalogueRow {
  period_id: string;
  period_title: string;
  feedback_type: "mid_semester" | "end_semester";
  closes_at: string;
  allow_editing: boolean;
  course_id: string;
  course_code: string;
  course_title: string;
  credits: number;
  semester: number;
  category: string;
  department: string;
  academic_year: string;
  coordinator_name: string | null;
  lecturer_count: number;
  submission_status: FeedbackSubmissionStatus;
}

export async function getFeedbackCatalogue(): Promise<
  Result<FeedbackCatalogueRow[]>
> {
  const { data, error } = await supabase.rpc("get_student_feedback_catalogue");
  if (error) return fail("getFeedbackCatalogue", error);
  return { ok: true, data: (data ?? []) as FeedbackCatalogueRow[] };
}

export interface FeedbackFormLecturer {
  lecturer_id: string;
  name: string;
  assignment_role: "lecturer" | "coordinator";
}

export interface FeedbackAnswerInput {
  question_id: string;
  /** Null for a course-level answer; the lecturer being rated otherwise. */
  lecturer_target_id?: string | null;
  rating_value?: number | null;
  text_value?: string | null;
  choice_value?: string | null;
  /** Several picks at once, for a multi-select. */
  choice_values?: string[] | null;
}

export type FeedbackFormError =
  | "period_not_found"
  | "not_eligible"
  | "no_questions";

export interface FeedbackFormData {
  error?: FeedbackFormError;
  course: {
    id: string;
    course_code: string;
    title: string;
    credits: number;
    semester: number;
    category: string;
    department: string;
    lecturer_name: string | null;
  } | null;
  /** Flat list, kept for callers that do not group. Same set as `sections`. */
  questions: FeedbackQuestion[];
  sections: FeedbackSection[];
  /** The lecturers who actually taught this delivery, from the assignment
   *  records — never typed in by the student, so responses can be aggregated
   *  per lecturer rather than per spelling of a name. */
  lecturers: FeedbackFormLecturer[];
  /** Shown in the course header, exactly as the faculty's form does. */
  coordinator_name: string | null;
  academic_year: string | null;
  period_title: string | null;
  closes_at: string | null;
  offering_id: string | null;
  feedback_type: "mid_semester" | "end_semester";
  submission: {
    id: string;
    status: "draft" | "submitted";
    is_anonymous: boolean;
    answers: FeedbackAnswerInput[];
  } | null;
  period_open: boolean;
  allow_editing: boolean;
  can_edit: boolean;
}

/**
 * The key an answer is stored and submitted under.
 *
 * A lecturer-targeted question is asked once per lecturer, so question id
 * alone is not unique within a submission — keying on it would silently
 * collapse three lecturers' ratings into one.
 */
export function answerKey(
  questionId: string,
  lecturerTargetId?: string | null,
): string {
  return lecturerTargetId ? `${questionId}::${lecturerTargetId}` : questionId;
}

/**
 * Whether a question is currently shown, given the answers so far.
 *
 * Mirrors `missing_required_feedback()` in the database: a question whose
 * gate is unanswered, or answered another way, is neither shown nor required.
 * The two must agree, or a student sees a form they cannot submit.
 */
export function isQuestionVisible(
  question: FeedbackQuestion,
  answers: Record<string, FeedbackAnswerInput>,
  lecturerTargetId?: string | null,
): boolean {
  if (!question.depends_on_question_id || !question.depends_on_values) {
    return true;
  }
  // A gate is answered once for the whole form even when it guards a
  // lecturer section, so look for the course-level answer first.
  const gate =
    answers[answerKey(question.depends_on_question_id, lecturerTargetId)] ??
    answers[answerKey(question.depends_on_question_id)];
  if (!gate) return false;
  // A multi-select gate is satisfied by any one of its picks, so it is
  // checked as a set rather than folded into the single-value chain below.
  if (gate.choice_values && gate.choice_values.length > 0) {
    return gate.choice_values.some((v) =>
      question.depends_on_values!.includes(v),
    );
  }
  const given =
    gate.choice_value ??
    gate.text_value ??
    (gate.rating_value != null ? String(gate.rating_value) : null);
  return given != null && question.depends_on_values.includes(given);
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Supabase surfaces failures on the `error` field rather than throwing, so
 * every call here inspects it. Technical detail goes to the console for
 * debugging; the caller only ever receives a sentence fit to show a student.
 */
function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[feedback] ${context}`, error);
  const raw =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return { ok: false, error: friendlyError(raw) };
}

const GENERIC = "Something went wrong. Please try again.";

/**
 * Turns a Supabase/Postgres error message into something worth showing a
 * student.
 *
 * The feedback RPCs deliberately raise plain sentences ("This feedback period
 * has already closed."), so those are passed through unchanged. Anything that
 * looks like database or transport plumbing is replaced — a student can act on
 * neither an RLS violation nor a missing relation.
 */
function friendlyError(raw: string): string {
  const msg = raw.trim();
  if (!msg) return GENERIC;

  if (
    /row-level security|permission denied|not authorized|access denied|JWT/i.test(
      msg,
    )
  ) {
    return "You do not have permission to do that.";
  }
  if (/failed to fetch|networkerror|network request failed/i.test(msg)) {
    return "We could not reach the server. Check your connection and try again.";
  }
  if (/duplicate key|unique constraint/i.test(msg)) {
    return "That response has already been recorded.";
  }
  if (
    /does not exist|syntax error|invalid input syntax|violates|constraint|null value/i.test(
      msg,
    )
  ) {
    return GENERIC;
  }

  // A sentence raised by our own SQL — already written for students.
  if (msg.length <= 200 && /^[A-Z][^\n]*[.!?]$/.test(msg)) return msg;

  return GENERIC;
}

export async function getActiveFeedbackPeriods(): Promise<
  Result<FeedbackPeriod[]>
> {
  const { data, error } = await supabase.rpc(
    "get_student_active_feedback_period",
  );
  if (error) return fail("getActiveFeedbackPeriods", error);
  return { ok: true, data: (data ?? []) as FeedbackPeriod[] };
}

export async function getEligibleCourses(
  periodId: string,
): Promise<Result<EligibleFeedbackCourse[]>> {
  const { data, error } = await supabase.rpc(
    "get_student_eligible_feedback_courses",
    { p_period_id: periodId },
  );
  if (error) return fail("getEligibleCourses", error);
  return { ok: true, data: (data ?? []) as EligibleFeedbackCourse[] };
}

export async function getFeedbackForm(
  periodId: string,
  courseId: string,
): Promise<Result<FeedbackFormData>> {
  const { data, error } = await supabase.rpc("get_student_feedback_form", {
    p_period_id: periodId,
    p_course_id: courseId,
  });
  if (error) return fail("getFeedbackForm", error);
  if (!data) {
    return { ok: false, error: "This feedback form could not be loaded." };
  }
  return { ok: true, data: data as FeedbackFormData };
}

export async function saveDraft(
  periodId: string,
  courseId: string,
  isAnonymous: boolean,
  answers: FeedbackAnswerInput[],
): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("save_feedback_draft", {
    p_period_id: periodId,
    p_course_id: courseId,
    p_is_anonymous: isAnonymous,
    p_answers: answers,
  });
  if (error) return fail("saveDraft", error);
  return { ok: true, data: data as string };
}

export async function submitFeedback(
  periodId: string,
  courseId: string,
  isAnonymous: boolean,
  answers: FeedbackAnswerInput[],
): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("submit_course_feedback", {
    p_period_id: periodId,
    p_course_id: courseId,
    p_is_anonymous: isAnonymous,
    p_answers: answers,
  });
  if (error) return fail("submitFeedback", error);
  return { ok: true, data: data as string };
}

// ---------------------------------------------------------------------
// Admin-side
// ---------------------------------------------------------------------

export interface AdminFeedbackPeriod {
  id: string;
  title: string;
  academic_year: string;
  semester: number;
  batch_year: number | null;
  department: string | null;
  feedback_type: "mid_semester" | "end_semester";
  opens_at: string;
  closes_at: string;
  status: "draft" | "scheduled" | "open" | "closed" | "archived";
  allow_editing: boolean;
}

export interface AdminFeedbackSummary {
  total_eligible: number;
  submitted: number;
  pending: number;
  response_rate: number;
  anonymous_count: number;
  non_anonymous_count: number;
  overall_avg_rating: number;
}

export interface CourseAnalytics {
  course_id: string;
  course_code: string;
  title: string;
  department: string;
  semester: number;
  eligible_count: number;
  response_count: number;
  response_rate: number;
  avg_rating: number | null;
  anonymous_count: number;
  non_anonymous_count: number;
}

export interface QuestionAnalytics {
  question_id: string;
  question_text: string;
  category: string | null;
  response_count: number;
  avg_rating: number | null;
  count_1: number;
  count_2: number;
  count_3: number;
  count_4: number;
  count_5: number;
  pct_positive: number | null;
  pct_neutral: number | null;
  pct_negative: number | null;
}

export interface FeedbackComment {
  submission_id: string;
  course_code: string;
  course_title: string;
  question_category: string | null;
  question_text: string;
  comment: string;
  is_anonymous: boolean;
  student_name: string | null;
  student_reg: string | null;
  submitted_date: string;
}

export async function getAdminFeedbackPeriods(): Promise<AdminFeedbackPeriod[]> {
  const { data, error } = await supabase.rpc("get_admin_feedback_periods");
  if (error || !data) return [];
  return data as AdminFeedbackPeriod[];
}

export async function getAdminFeedbackSummary(
  periodId: string | null,
  courseId: string | null = null,
  batchYear: number | null = null,
): Promise<AdminFeedbackSummary | null> {
  const { data, error } = await supabase.rpc("get_admin_feedback_summary", {
    p_period_id: periodId,
    p_course_id: courseId,
    p_batch_year: batchYear,
  });
  if (error || !data) return null;
  return data as AdminFeedbackSummary;
}

export async function getCourseAnalytics(
  periodId: string,
): Promise<CourseAnalytics[]> {
  const { data, error } = await supabase.rpc(
    "get_admin_course_feedback_analytics",
    { p_period_id: periodId },
  );
  if (error || !data) return [];
  return data as CourseAnalytics[];
}

export async function getQuestionAnalytics(
  periodId: string,
  courseId: string | null = null,
): Promise<QuestionAnalytics[]> {
  const { data, error } = await supabase.rpc(
    "get_admin_question_feedback_analytics",
    { p_period_id: periodId, p_course_id: courseId },
  );
  if (error || !data) return [];
  return data as QuestionAnalytics[];
}

export async function getFeedbackComments(
  periodId: string,
  courseId: string | null = null,
): Promise<FeedbackComment[]> {
  const { data, error } = await supabase.rpc("get_admin_feedback_comments", {
    p_period_id: periodId,
    p_course_id: courseId,
  });
  if (error || !data) return [];
  return data as FeedbackComment[];
}

/**
 * Build a CSV of feedback for the given period.
 *
 * Privacy rules, applied here and reinforced by the RPCs this reads from:
 * anonymous submissions never carry a name or registration number, drafts
 * are excluded (the analytics RPCs only return submitted rows), the caller's
 * own department scope is enforced server-side, and courses below the
 * minimum-response threshold are already suppressed upstream.
 */
export function buildFeedbackCsv(
  period: AdminFeedbackPeriod,
  courses: CourseAnalytics[],
  questions: QuestionAnalytics[],
  comments: FeedbackComment[],
): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    // Guard against CSV formula injection when opened in Excel.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const row = (cells: unknown[]) => cells.map(esc).join(",");
  const lines: string[] = [];

  lines.push(row(["Feedback Period", period.title]));
  lines.push(row(["Academic Year", period.academic_year]));
  lines.push(row(["Semester", period.semester]));
  lines.push(row(["Batch Year", period.batch_year ?? "All"]));
  lines.push(row(["Department", period.department ?? "All Departments"]));
  lines.push(row(["Exported At", new Date().toISOString()]));
  lines.push("");

  lines.push(row(["COURSE SUMMARY"]));
  lines.push(
    row([
      "Course Code",
      "Course",
      "Owning Department",
      "Semester",
      "Eligible",
      "Responses",
      "Response Rate (%)",
      "Average Rating",
      "Anonymous",
      "Identified",
    ]),
  );
  courses.forEach((c) =>
    lines.push(
      row([
        c.course_code,
        c.title,
        c.department,
        c.semester,
        c.eligible_count,
        c.response_count,
        c.response_rate,
        c.avg_rating ?? "",
        c.anonymous_count,
        c.non_anonymous_count,
      ]),
    ),
  );
  lines.push("");

  lines.push(row(["QUESTION RATINGS"]));
  lines.push(
    row([
      "Question",
      "Category",
      "Responses",
      "Average",
      "1",
      "2",
      "3",
      "4",
      "5",
      "Positive (%)",
      "Neutral (%)",
      "Negative (%)",
    ]),
  );
  questions.forEach((q) =>
    lines.push(
      row([
        q.question_text,
        q.category ?? "",
        q.response_count,
        q.avg_rating ?? "",
        q.count_1,
        q.count_2,
        q.count_3,
        q.count_4,
        q.count_5,
        q.pct_positive ?? "",
        q.pct_neutral ?? "",
        q.pct_negative ?? "",
      ]),
    ),
  );
  lines.push("");

  lines.push(row(["WRITTEN COMMENTS"]));
  lines.push(
    row([
      "Course Code",
      "Course",
      "Question",
      "Category",
      "Comment",
      "Anonymous",
      "Student",
      "Registration No",
      "Submitted",
    ]),
  );
  comments.forEach((c) =>
    lines.push(
      row([
        c.course_code,
        c.course_title,
        c.question_text,
        c.question_category ?? "",
        c.comment,
        c.is_anonymous ? "Yes" : "No",
        c.is_anonymous ? "" : (c.student_name ?? ""),
        c.is_anonymous ? "" : (c.student_reg ?? ""),
        c.submitted_date,
      ]),
    ),
  );

  return lines.join("\r\n");
}

/**
 * Excel export as SpreadsheetML 2003 — a documented XML format Excel opens
 * natively with real multi-sheet support, so no third-party dependency is
 * needed. Identity is omitted for anonymous rows exactly as in the CSV.
 */
export function buildFeedbackExcel(
  period: AdminFeedbackPeriod,
  courses: CourseAnalytics[],
  questions: QuestionAnalytics[],
  comments: FeedbackComment[],
): string {
  const esc = (v: unknown): string =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const cell = (v: unknown, numeric = false) =>
    `<Cell><Data ss:Type="${numeric && v !== null && v !== "" ? "Number" : "String"}">${esc(v)}</Data></Cell>`;

  const row = (cells: string[]) => `<Row>${cells.join("")}</Row>`;

  const sheet = (name: string, rows: string[]) =>
    `<Worksheet ss:Name="${esc(name)}"><Table>${rows.join("")}</Table></Worksheet>`;

  const overview = sheet("Overview", [
    row([cell("Feedback Period"), cell(period.title)]),
    row([cell("Academic Year"), cell(period.academic_year)]),
    row([cell("Semester"), cell(period.semester, true)]),
    row([cell("Batch Year"), cell(period.batch_year ?? "All")]),
    row([cell("Department"), cell(period.department ?? "All Departments")]),
    row([cell("Exported At"), cell(new Date().toISOString())]),
  ]);

  const courseSheet = sheet("Courses", [
    row(
      [
        "Course Code",
        "Course",
        "Owning Department",
        "Semester",
        "Eligible",
        "Responses",
        "Response Rate (%)",
        "Average Rating",
        "Anonymous",
        "Identified",
      ].map((h) => cell(h)),
    ),
    ...courses.map((c) =>
      row([
        cell(c.course_code),
        cell(c.title),
        cell(c.department),
        cell(c.semester, true),
        cell(c.eligible_count, true),
        cell(c.response_count, true),
        cell(c.response_rate, true),
        cell(c.avg_rating ?? "", true),
        cell(c.anonymous_count, true),
        cell(c.non_anonymous_count, true),
      ]),
    ),
  ]);

  const questionSheet = sheet("Questions", [
    row(
      [
        "Question",
        "Category",
        "Responses",
        "Average",
        "1",
        "2",
        "3",
        "4",
        "5",
        "Positive (%)",
        "Neutral (%)",
        "Negative (%)",
      ].map((h) => cell(h)),
    ),
    ...questions.map((q) =>
      row([
        cell(q.question_text),
        cell(q.category ?? ""),
        cell(q.response_count, true),
        cell(q.avg_rating ?? "", true),
        cell(q.count_1, true),
        cell(q.count_2, true),
        cell(q.count_3, true),
        cell(q.count_4, true),
        cell(q.count_5, true),
        cell(q.pct_positive ?? "", true),
        cell(q.pct_neutral ?? "", true),
        cell(q.pct_negative ?? "", true),
      ]),
    ),
  ]);

  const commentSheet = sheet("Comments", [
    row(
      [
        "Course Code",
        "Course",
        "Question",
        "Category",
        "Comment",
        "Anonymous",
        "Student",
        "Registration No",
        "Submitted",
      ].map((h) => cell(h)),
    ),
    ...comments.map((c) =>
      row([
        cell(c.course_code),
        cell(c.course_title),
        cell(c.question_text),
        cell(c.question_category ?? ""),
        cell(c.comment),
        cell(c.is_anonymous ? "Yes" : "No"),
        cell(c.is_anonymous ? "" : (c.student_name ?? "")),
        cell(c.is_anonymous ? "" : (c.student_reg ?? "")),
        cell(c.submitted_date),
      ]),
    ),
  ]);

  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${overview}${courseSheet}${questionSheet}${commentSheet}</Workbook>`;
}

export function downloadExcel(filename: string, xml: string): void {
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function getQuestionBank(): Promise<FeedbackQuestion[]> {
  const { data, error } = await supabase
    .from("feedback_questions")
    .select("*")
    .eq("is_active", true)
    .order("display_order");
  if (error || !data) return [];
  return data as FeedbackQuestion[];
}

export interface QuestionDraft {
  question_text: string;
  question_type: FeedbackQuestionType;
  target_type: "course" | "lecturer";
  section_key: string | null;
  section_title: string | null;
  section_order: number;
  category: string | null;
  is_required: boolean;
  options: FeedbackOption[] | null;
  depends_on_question_id: string | null;
  depends_on_values: string[] | null;
}

/**
 * Normalises a draft to what the table's constraints accept.
 *
 * `options` must be a non-empty array for single_choice and null for
 * everything else, and a dependency needs both halves or neither. Getting
 * this wrong surfaces as a check-constraint violation with a message no
 * admin can act on, so it is fixed here rather than reported.
 */
function normaliseQuestion(draft: QuestionDraft) {
  const isChoice = draft.question_type === "single_choice";
  const hasDependency =
    Boolean(draft.depends_on_question_id) &&
    (draft.depends_on_values?.length ?? 0) > 0;

  return {
    question_text: draft.question_text.trim(),
    question_type: draft.question_type,
    target_type: draft.target_type,
    section_key:
      draft.section_key?.trim() ||
      (draft.section_title?.trim().toLowerCase().replace(/\W+/g, "_") ?? null),
    section_title: draft.section_title?.trim() || null,
    section_order: draft.section_order,
    category: draft.category?.trim() || draft.section_title?.trim() || null,
    is_required: draft.is_required,
    options: isChoice ? (draft.options ?? []) : null,
    depends_on_question_id: hasDependency ? draft.depends_on_question_id : null,
    depends_on_values: hasDependency ? draft.depends_on_values : null,
  };
}

export async function createQuestion(
  draft: QuestionDraft & { created_by: string },
): Promise<{ ok: true; question: FeedbackQuestion } | { ok: false; error: string }> {
  const { data: maxOrder } = await supabase
    .from("feedback_questions")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("feedback_questions")
    .insert({
      ...normaliseQuestion(draft),
      created_by: draft.created_by,
      display_order: (maxOrder?.display_order ?? 0) + 1,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create question." };
  }
  return { ok: true, question: data as FeedbackQuestion };
}

export async function updateQuestion(
  id: string,
  draft: QuestionDraft,
): Promise<{ ok: true; question: FeedbackQuestion } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("feedback_questions")
    .update({ ...normaliseQuestion(draft), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not update question." };
  }
  return { ok: true, question: data as FeedbackQuestion };
}

/**
 * Retires a question rather than deleting it — answers already given point
 * at it, and a deleted question would take that history with it.
 */
export async function retireQuestion(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("feedback_questions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createFeedbackPeriod(payload: {
  title: string;
  academic_year: string;
  semester: number;
  batch_year: number;
  department: string | null;
  /**
   * Which round this is. The column has always existed and every screen that
   * reads a period shows it; only this form never asked, so a department's
   * mid-semester round was silently filed as an end-of-semester one.
   */
  feedback_type: "mid_semester" | "end_semester";
  opens_at: string;
  closes_at: string;
  allow_editing: boolean;
  created_by: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("feedback_periods")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Could not create feedback period.",
    };
  }
  return { ok: true, id: data.id };
}

export async function setPeriodCourses(
  periodId: string,
  courseIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  await supabase
    .from("feedback_period_courses")
    .delete()
    .eq("feedback_period_id", periodId);
  if (courseIds.length === 0) return { ok: true };
  const { error } = await supabase.from("feedback_period_courses").insert(
    courseIds.map((course_id) => ({ feedback_period_id: periodId, course_id })),
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setPeriodQuestions(
  periodId: string,
  questionIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  await supabase
    .from("feedback_period_questions")
    .delete()
    .eq("feedback_period_id", periodId);
  if (questionIds.length === 0) return { ok: true };
  const { error } = await supabase.from("feedback_period_questions").insert(
    questionIds.map((question_id, i) => ({
      feedback_period_id: periodId,
      question_id,
      display_order: i + 1,
    })),
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updatePeriodStatus(
  periodId: string,
  status: "draft" | "scheduled" | "open" | "closed" | "archived",
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("feedback_periods")
    .update({ status })
    .eq("id", periodId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getPeriodCourseIds(periodId: string): Promise<string[]> {
  const { data } = await supabase
    .from("feedback_period_courses")
    .select("course_id")
    .eq("feedback_period_id", periodId);
  return (data ?? []).map((r: any) => r.course_id);
}

export async function getPeriodQuestionIds(periodId: string): Promise<string[]> {
  const { data } = await supabase
    .from("feedback_period_questions")
    .select("question_id")
    .eq("feedback_period_id", periodId)
    .order("display_order");
  return (data ?? []).map((r: any) => r.question_id);
}
