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

export interface FeedbackQuestion {
  id: string;
  question_text: string;
  question_type: "rating" | "short_text" | "long_text";
  category: string | null;
  display_order: number;
  is_required: boolean;
}

export interface FeedbackAnswerInput {
  question_id: string;
  rating_value?: number | null;
  text_value?: string | null;
}

export interface FeedbackFormData {
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
  questions: FeedbackQuestion[];
  submission: {
    id: string;
    status: "draft" | "submitted";
    is_anonymous: boolean;
    answers: FeedbackAnswerInput[];
  } | null;
}

// Friendly wrapper so pages never have to interpret raw Postgres error text.
const FRIENDLY_ERRORS: Record<string, string> = {
  "This feedback period has already closed.":
    "This feedback period has already closed.",
  "You are not eligible to submit feedback for this course.":
    "You are not eligible to submit feedback for this course.",
  "You have already submitted feedback for this course.":
    "You have already submitted feedback for this course.",
  "Please answer all required questions.":
    "Please answer all required questions.",
};

function friendlyError(raw: string | undefined): string {
  if (!raw) return "Your feedback could not be saved. Please try again.";
  return FRIENDLY_ERRORS[raw] ?? "Your feedback could not be saved. Please try again.";
}

export async function getActiveFeedbackPeriod(): Promise<FeedbackPeriod | null> {
  // RPC rather than a direct table query: it also filters by the calling
  // student's own batch, so a period aimed at another batch never shows.
  const { data, error } = await supabase.rpc(
    "get_student_active_feedback_period",
  );

  if (error || !data || data.length === 0) return null;
  return data[0] as FeedbackPeriod;
}

export async function getEligibleCourses(
  periodId: string,
): Promise<EligibleFeedbackCourse[]> {
  const { data, error } = await supabase.rpc(
    "get_student_eligible_feedback_courses",
    { p_period_id: periodId },
  );
  if (error || !data) return [];
  return data as EligibleFeedbackCourse[];
}

export async function getFeedbackForm(
  periodId: string,
  courseId: string,
): Promise<FeedbackFormData | null> {
  const { data, error } = await supabase.rpc("get_student_feedback_form", {
    p_period_id: periodId,
    p_course_id: courseId,
  });
  if (error || !data) return null;
  return data as FeedbackFormData;
}

export async function saveDraft(
  periodId: string,
  courseId: string,
  isAnonymous: boolean,
  answers: FeedbackAnswerInput[],
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("save_feedback_draft", {
    p_period_id: periodId,
    p_course_id: courseId,
    p_is_anonymous: isAnonymous,
    p_answers: answers,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  return { ok: true, id: data as string };
}

export async function submitFeedback(
  periodId: string,
  courseId: string,
  isAnonymous: boolean,
  answers: FeedbackAnswerInput[],
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("submit_course_feedback", {
    p_period_id: periodId,
    p_course_id: courseId,
    p_is_anonymous: isAnonymous,
    p_answers: answers,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  return { ok: true, id: data as string };
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

export async function createQuestion(payload: {
  question_text: string;
  question_type: "rating" | "short_text" | "long_text";
  category: string | null;
  is_required: boolean;
  created_by: string;
}): Promise<{ ok: true; question: FeedbackQuestion } | { ok: false; error: string }> {
  const { data: maxOrder } = await supabase
    .from("feedback_questions")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("feedback_questions")
    .insert({
      ...payload,
      display_order: (maxOrder?.display_order ?? 0) + 1,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create question." };
  }
  return { ok: true, question: data as FeedbackQuestion };
}

export async function createFeedbackPeriod(payload: {
  title: string;
  academic_year: string;
  semester: number;
  batch_year: number;
  department: string | null;
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
