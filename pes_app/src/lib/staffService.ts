import { supabase } from "./supabase";

/**
 * Data layer for the staff portal.
 *
 * Every call here goes through a SECURITY DEFINER function that resolves the
 * caller's own teaching assignments server-side. That is not incidental: a
 * lecturer has no RLS grant on `students` at all, and an offering is taken by
 * students from every department, so a client-side join could only ever
 * resolve a fraction of a roster — the same trap the admin pages hit.
 *
 * Kept out of the components so the pages do not each re-implement it, which
 * is how the admin pages ended up with five copies of the same batch query.
 */

export interface CoLecturer {
  lecturer_id: string;
  name: string;
  assignment_role: "lecturer" | "coordinator";
}

export interface TeachingOffering {
  offering_id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  credits: number;
  semester: number;
  academic_year: string;
  batch_year: number;
  department: string;
  my_role: "lecturer" | "coordinator";
  co_lecturers: CoLecturer[];
  enrolled_count: number;
  draft_count: number;
  submitted_count: number;
  published_count: number;
  /** The semester this offering's batch is sitting now. */
  batch_current_semester: number | null;
  /** True when this offering is that semester — the class being taught now.
   *  False for a delivery that has finished: still reachable for a repeat
   *  student, a late result or a feedback round opened after the fact. */
  is_current: boolean;
}

export interface DepartmentOffering {
  offering_id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  credits: number;
  category: string;
  semester: number;
  academic_year: string;
  batch_year: number;
  department: string;
  lecturers: (CoLecturer & { assignment_id: string; email: string })[];
  enrolled_count: number;
  batch_current_semester: number | null;
  is_current: boolean;
}

export interface AssignableLecturer {
  lecturer_id: string;
  name: string;
  email: string;
  department: string;
  is_hod: boolean;
}

export interface RosterStudent {
  student_id: string;
  name: string;
  index_number: string | null;
  reg_number: string | null;
  department: string;
  batch_year: number;
  is_repeat: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(context: string, error: { message: string }): { ok: false; error: string } {
  console.error(`[staffService] ${context}`, error);
  return { ok: false, error: error.message };
}

/** Offerings the signed-in lecturer teaches, newest cohort first. */
export async function getMyTeaching(): Promise<Result<TeachingOffering[]>> {
  const { data, error } = await supabase.rpc("get_my_teaching");
  if (error) return fail("get_my_teaching", error);
  return { ok: true, data: (data ?? []) as TeachingOffering[] };
}

/** Offerings in the caller's department, with their current teaching staff. */
export async function getDepartmentTeaching(
  batchYear: number | null,
  semester: number | null,
): Promise<Result<DepartmentOffering[]>> {
  const { data, error } = await supabase.rpc("get_department_teaching", {
    p_batch_year: batchYear,
    p_semester: semester,
  });
  if (error) return fail("get_department_teaching", error);
  return { ok: true, data: (data ?? []) as DepartmentOffering[] };
}

export async function getAssignableLecturers(): Promise<Result<AssignableLecturer[]>> {
  const { data, error } = await supabase.rpc("get_assignable_lecturers");
  if (error) return fail("get_assignable_lecturers", error);
  return { ok: true, data: (data ?? []) as AssignableLecturer[] };
}

export async function getOfferingRoster(
  offeringId: string,
): Promise<Result<RosterStudent[]>> {
  const { data, error } = await supabase.rpc("get_offering_roster", {
    p_offering_id: offeringId,
  });
  if (error) return fail("get_offering_roster", error);
  return { ok: true, data: (data ?? []) as RosterStudent[] };
}

/**
 * Assign a lecturer to an offering. Uniqueness (one live row per
 * lecturer+offering, one coordinator per offering) is a database constraint,
 * so a duplicate surfaces here as an error rather than being pre-checked and
 * raced.
 */
export async function assignLecturer(
  offeringId: string,
  lecturerId: string,
  role: "lecturer" | "coordinator",
  assignedBy: string,
): Promise<Result<null>> {
  const { error } = await supabase.from("course_lecturers").insert({
    offering_id: offeringId,
    lecturer_id: lecturerId,
    assignment_role: role,
    assigned_by: assignedBy,
  });
  if (error) {
    if (error.message.includes("one_active_coordinator")) {
      return {
        ok: false,
        error: "This offering already has a course coordinator.",
      };
    }
    if (error.message.includes("one_active_per_pair")) {
      return {
        ok: false,
        error: "That lecturer is already assigned to this offering.",
      };
    }
    return fail("assignLecturer", error);
  }
  return { ok: true, data: null };
}

/** End an assignment. The row is kept and marked inactive so the teaching
 *  history behind past results and feedback stays intact. */
export async function endAssignment(
  assignmentId: string,
  endedBy: string,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("course_lecturers")
    .update({ is_active: false, ended_at: new Date().toISOString(), ended_by: endedBy })
    .eq("id", assignmentId);
  if (error) return fail("endAssignment", error);
  return { ok: true, data: null };
}

export async function setAssignmentRole(
  assignmentId: string,
  role: "lecturer" | "coordinator",
): Promise<Result<null>> {
  const { error } = await supabase
    .from("course_lecturers")
    .update({ assignment_role: role })
    .eq("id", assignmentId);
  if (error) {
    if (error.message.includes("one_active_coordinator")) {
      return {
        ok: false,
        error: "This offering already has a course coordinator.",
      };
    }
    return fail("setAssignmentRole", error);
  }
  return { ok: true, data: null };
}

/* ------------------------------------------------------------------ */
/* Department students (HOD)                                           */
/* ------------------------------------------------------------------ */

export interface DepartmentStudent {
  student_id: string;
  name: string;
  index_number: string | null;
  reg_number: string | null;
  email: string;
  department: string;
  batch_year: number;
  cgpa: number | null;
  gpa_credits: number;
  courses_graded: number;
  latest_semester: number;
}

export interface StudentRecordRow {
  semester: number;
  academic_year: string;
  course_code: string;
  course_title: string;
  credits: number;
  contributes_to_gpa: boolean;
  mid_sem_mark: number | null;
  ca_mark: number | null;
  ese_mark: number | null;
  oa_mark: number | null;
  grade: string | null;
  gpv: number | null;
}

export async function getDepartmentStudents(): Promise<Result<DepartmentStudent[]>> {
  const { data, error } = await supabase.rpc("get_department_students");
  if (error) return fail("get_department_students", error);
  return { ok: true, data: (data ?? []) as DepartmentStudent[] };
}

/** One student's published results across every semester. Refused by the
 *  database for a student outside the caller's own department. */
export async function getStudentAcademicRecord(
  studentId: string,
): Promise<Result<StudentRecordRow[]>> {
  const { data, error } = await supabase.rpc("get_student_academic_record", {
    p_student_id: studentId,
  });
  if (error) return fail("get_student_academic_record", error);
  return { ok: true, data: (data ?? []) as StudentRecordRow[] };
}

/* ------------------------------------------------------------------ */
/* Result entry                                                        */
/* ------------------------------------------------------------------ */

export interface OfferingResultRow {
  id: string;
  student_id: string;
  mid_sem_mark: number | null;
  ca_mark: number | null;
  ese_mark: number | null;
  oa_mark: number | null;
  grade: string | null;
  gpv: number | null;
  status: "draft" | "submitted" | "published";
  return_notes: string | null;
}

/**
 * Existing result rows for an offering. Read straight from the table rather
 * than through an RPC: `results_lecturer_read` already scopes this to the
 * caller's own offerings, and unlike `students` there is nothing here a
 * lecturer is not entitled to see for a course they teach.
 */
export async function getOfferingResults(
  offeringId: string,
): Promise<Result<OfferingResultRow[]>> {
  const { data, error } = await supabase
    .from("results")
    .select(
      "id, student_id, mid_sem_mark, ca_mark, ese_mark, oa_mark, grade, gpv, status, return_notes",
    )
    .eq("offering_id", offeringId);
  if (error) return fail("getOfferingResults", error);
  return { ok: true, data: (data ?? []) as OfferingResultRow[] };
}

export interface ResultUpsert {
  student_id: string;
  course_id: string;
  academic_year: string;
  offering_id: string;
  mid_sem_mark: number | null;
  ca_mark: number | null;
  /** Awarded, not calculated. gpv is absent on purpose: the database derives
   *  it from this grade, so no writer can save the two disagreeing. */
  grade: string | null;
}

/**
 * Save a whole sheet in one request.
 *
 * `results` already carries a unique key on (student_id, course_id,
 * academic_year), so this is a single upsert rather than the
 * update-or-insert-per-student loop the admin page still does — which fires
 * one round trip per student and can leave a sheet half-saved if one fails.
 */
export async function saveOfferingResults(
  rows: ResultUpsert[],
  enteredBy: string,
): Promise<Result<number>> {
  if (rows.length === 0) return { ok: true, data: 0 };
  const { error } = await supabase.from("results").upsert(
    rows.map((r) => ({ ...r, status: "draft", entered_by: enteredBy })),
    { onConflict: "student_id,course_id,academic_year" },
  );
  if (error) return fail("saveOfferingResults", error);
  return { ok: true, data: rows.length };
}

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

export type AttendanceStatus = "present" | "absent" | "excused";

export interface AttendanceRow {
  id: string;
  student_id: string;
  lecture_date: string;
  status: AttendanceStatus;
}

/** Every recorded lecture for an offering, so the page can show which dates
 *  already exist rather than only the one being marked. */
export async function getOfferingAttendance(
  offeringId: string,
): Promise<Result<AttendanceRow[]>> {
  const { data, error } = await supabase
    .from("attendance")
    .select("id, student_id, lecture_date, status")
    .eq("offering_id", offeringId)
    .order("lecture_date", { ascending: false });
  if (error) return fail("getOfferingAttendance", error);
  return { ok: true, data: (data ?? []) as AttendanceRow[] };
}

export async function saveOfferingAttendance(
  offeringId: string,
  courseId: string,
  lectureDate: string,
  marks: { student_id: string; status: AttendanceStatus }[],
  recordedBy: string,
): Promise<Result<number>> {
  if (marks.length === 0) return { ok: true, data: 0 };
  const { error } = await supabase.from("attendance").upsert(
    marks.map((m) => ({
      student_id: m.student_id,
      course_id: courseId,
      offering_id: offeringId,
      lecture_date: lectureDate,
      status: m.status,
      recorded_by: recordedBy,
    })),
    { onConflict: "student_id,course_id,lecture_date" },
  );
  if (error) return fail("saveOfferingAttendance", error);
  return { ok: true, data: marks.length };
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export interface FeedbackOverviewRow {
  period_id: string;
  period_title: string;
  period_status: "draft" | "scheduled" | "open" | "closed" | "archived";
  feedback_type: "mid_semester" | "end_semester";
  offering_id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  semester: number;
  batch_year: number;
  eligible_count: number;
  response_count: number;
  response_rate: number;
  /** Answering has begun and enough people have answered to be anonymous. */
  results_visible: boolean;
  below_threshold: boolean;
  /** Null while the results are withheld. */
  avg_rating: number | null;
}

/* The report comes back as sections of three uniform shapes, so a question a
   coordinator added arrives through the same pipe as the faculty's own. */

export interface ReportRating {
  question_id: string;
  question: string;
  average: number;
  answered: number;
}

export interface ReportTally {
  value: string;
  label: string;
  count: number;
  /** Share of the students who answered this question, not of the ticks. */
  pct: number;
}

export interface ReportChoice {
  question_id: string;
  question: string;
  question_type: "single_choice" | "multi_select" | "yes_no";
  answered: number;
  tallies: ReportTally[];
}

export interface ReportText {
  question_id: string;
  question: string;
  answers: string[];
  answered: number;
}

export interface ReportSection {
  section_key: string;
  section_title: string;
  section_icon: string | null;
  ratings: ReportRating[];
  choices: ReportChoice[];
  texts: ReportText[];
  average: number | null;
}

export interface CourseFeedbackReport {
  course_code: string;
  course_title: string;
  lecturer_name: string;
  feedback_type: "mid_semester" | "end_semester";
  period_title: string;
  period_status: FeedbackPeriodStatus;
  semester: number;
  batch_year: number | null;
  academic_year: string;
  closes_at: string;
  response_count: number;
  threshold: number;
  generated_on: string;
  /** False below the privacy threshold: counts only, nothing anyone said. */
  visible: boolean;
  sections: ReportSection[];
  scores: {
    lecturer_overall: number | null;
    course_content: number | null;
  };
}

/**
 * Every course the lecturer teaches that has a feedback period. Response
 * progress is always visible; what students said waits for the round to open
 * and for enough people to have answered.
 */
export async function getMyFeedbackOverview(): Promise<Result<FeedbackOverviewRow[]>> {
  const { data, error } = await supabase.rpc("get_my_feedback_overview");
  if (error) return fail("get_my_feedback_overview", error);
  return { ok: true, data: (data ?? []) as FeedbackOverviewRow[] };
}

/** The full report for one course in one round, as the faculty prints it. */
export async function getCourseFeedbackReport(
  periodId: string,
  courseId: string,
): Promise<Result<CourseFeedbackReport>> {
  const { data, error } = await supabase.rpc("get_course_feedback_report", {
    p_period_id: periodId,
    p_course_id: courseId,
  });
  if (error) return fail("get_course_feedback_report", error);
  return { ok: true, data: data as CourseFeedbackReport };
}

export interface WorkflowOutcome {
  ok: boolean;
  message: string;
}

async function callWorkflow(
  fn: string,
  args: Record<string, unknown>,
): Promise<Result<WorkflowOutcome>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return fail(fn, error);
  return {
    ok: true,
    data: {
      ok: Boolean(data?.ok),
      message: data?.message ?? "Done.",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Department-wide feedback (head of department)                       */
/* ------------------------------------------------------------------ */

export interface DepartmentFeedbackRow {
  period_id: string;
  period_title: string;
  period_status: FeedbackPeriodStatus;
  feedback_type: "mid_semester" | "end_semester";
  offering_id: string;
  course_code: string;
  course_title: string;
  semester: number;
  batch_year: number;
  lecturers: string | null;
  eligible_count: number;
  response_count: number;
  response_rate: number;
  /** Open or closed, and above the anonymity threshold. */
  results_visible: boolean;
  below_threshold: boolean;
  avg_rating: number | null;
}

export interface DepartmentLecturerRow {
  lecturer_id: string;
  lecturer_name: string;
  is_hod: boolean;
  course_count: number;
  courses_counted: number;
  courses_withheld: number;
  response_count: number;
  rated_answers: number;
  avg_rating: number | null;
}

export interface DepartmentQuestionResult {
  question_id: string;
  question_text: string;
  question_type: string;
  section_title: string | null;
  responses: number;
  average: number | null;
  distribution: Record<string, number>;
}

export interface DepartmentFeedbackDetail {
  visible: boolean;
  below_threshold?: boolean;
  threshold?: number;
  response_count?: number;
  message?: string;
  course_questions?: DepartmentQuestionResult[];
  lecturer_questions?: {
    lecturer_id: string;
    lecturer_name: string;
    questions: DepartmentQuestionResult[];
  }[];
  comments?: {
    question_text: string;
    section_title: string | null;
    about_lecturer: string | null;
    comment: string;
  }[];
}

export async function getDepartmentFeedbackOverview(
  periodId: string | null = null,
): Promise<Result<DepartmentFeedbackRow[]>> {
  const { data, error } = await supabase.rpc("get_department_feedback_overview", {
    p_period_id: periodId,
  });
  if (error) return fail("get_department_feedback_overview", error);
  return { ok: true, data: (data ?? []) as DepartmentFeedbackRow[] };
}

export async function getDepartmentLecturerFeedback(
  periodId: string | null = null,
): Promise<Result<DepartmentLecturerRow[]>> {
  const { data, error } = await supabase.rpc("get_department_lecturer_feedback", {
    p_period_id: periodId,
  });
  if (error) return fail("get_department_lecturer_feedback", error);
  return { ok: true, data: (data ?? []) as DepartmentLecturerRow[] };
}

export async function getDepartmentFeedbackDetail(
  periodId: string,
  offeringId: string,
): Promise<Result<DepartmentFeedbackDetail>> {
  const { data, error } = await supabase.rpc("get_department_feedback_detail", {
    p_period_id: periodId,
    p_offering_id: offeringId,
  });
  if (error) return fail("get_department_feedback_detail", error);
  return { ok: true, data: (data ?? { visible: false }) as DepartmentFeedbackDetail };
}

/* ------------------------------------------------------------------ */
/* Course-specific questions (coordinator)                             */
/* ------------------------------------------------------------------ */

export interface CoordinatedQuestion {
  id: string;
  question_text: string;
  question_type: string;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  is_required: boolean;
}

export interface CoordinatedRound {
  period_id: string;
  period_title: string;
  period_status: FeedbackPeriodStatus;
  feedback_type: "mid_semester" | "end_semester";
  opens_at: string;
  closes_at: string;
  course_id: string;
  course_code: string;
  course_title: string;
  response_count: number;
  /** True only while the round is a draft — after that the form is fixed. */
  can_edit_questions: boolean;
  my_questions: CoordinatedQuestion[];
}

/** Feedback rounds covering a course this lecturer coordinates. */
export async function getMyCoordinatedFeedback(): Promise<Result<CoordinatedRound[]>> {
  const { data, error } = await supabase.rpc("get_my_coordinated_feedback");
  if (error) return fail("get_my_coordinated_feedback", error);
  return { ok: true, data: (data ?? []) as CoordinatedRound[] };
}

export async function addCourseQuestion(args: {
  periodId: string;
  courseId: string;
  questionText: string;
  questionType: string;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  isRequired: boolean;
}): Promise<Result<WorkflowOutcome>> {
  return callWorkflow("add_course_feedback_question", {
    p_period_id: args.periodId,
    p_course_id: args.courseId,
    p_question_text: args.questionText,
    p_question_type: args.questionType,
    p_options: args.options,
    p_placeholder: args.placeholder,
    p_is_required: args.isRequired,
  });
}

export async function removeCourseQuestion(
  periodId: string,
  courseId: string,
  questionId: string,
): Promise<Result<WorkflowOutcome>> {
  return callWorkflow("remove_course_feedback_question", {
    p_period_id: periodId,
    p_course_id: courseId,
    p_question_id: questionId,
  });
}

/* ------------------------------------------------------------------ */
/* Feedback form requests                                              */
/* ------------------------------------------------------------------ */

export type FeedbackApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected";

export type FeedbackPeriodStatus =
  | "draft"
  | "scheduled"
  | "open"
  | "closed"
  | "archived";

export interface FeedbackRequest {
  id: string;
  title: string;
  academic_year: string;
  semester: number;
  batch_year: number | null;
  feedback_type: "mid_semester" | "end_semester";
  opens_at: string;
  closes_at: string;
  status: FeedbackPeriodStatus;
  allow_editing: boolean;
  approval_status: FeedbackApprovalStatus;
  approval_notes: string | null;
  approved_at: string | null;
  created_at: string;
  course_ids: string[];
  question_ids: string[];
}

export interface FeedbackRequestDraft {
  title: string;
  feedback_type: "mid_semester" | "end_semester";
  academic_year: string;
  semester: number;
  batch_year: number;
  opens_at: string;
  closes_at: string;
  allow_editing: boolean;
  course_ids: string[];
  question_ids: string[];
}

/**
 * The database refuses in sentences no lecturer can act on — a policy name, a
 * constraint. Each rule below is one a lecturer can actually hit, so it is
 * answered with what they can do about it.
 */
function friendlyRequestError(raw: string): string {
  if (/needs department approval/i.test(raw)) {
    return "Your department has not approved this form yet, so it cannot open.";
  }
  if (/row-level security|permission denied/i.test(raw)) {
    return "You can only change your own form, and only before your department approves it.";
  }
  if (/duplicate key|unique constraint/i.test(raw)) {
    return "That course is already on this form.";
  }
  return "Something went wrong. Please try again.";
}

function requestFail(context: string, error: { message: string }) {
  console.error(`[staffService] ${context}`, error);
  return { ok: false as const, error: friendlyRequestError(error.message) };
}

/**
 * The forms this lecturer has asked to run.
 *
 * Filtered on the author explicitly rather than left to RLS: a separate
 * policy makes every non-draft period readable to everyone, so an unfiltered
 * select would return the whole faculty's feedback calendar.
 */
export async function getMyFeedbackRequests(
  lecturerId: string,
): Promise<Result<FeedbackRequest[]>> {
  const { data, error } = await supabase
    .from("feedback_periods")
    .select(
      /* One literal, not several joined with +. The client reads the select
         at the type level, and a concatenation widens to plain `string`,
         which it cannot read — so it typed these rows as an error, which is
         what the cast below was papering over. */
      "id, title, academic_year, semester, batch_year, feedback_type, opens_at, closes_at, status, allow_editing, approval_status, approval_notes, approved_at, created_at, feedback_period_courses(course_id), feedback_period_questions(question_id)",
    )
    .eq("created_by_lecturer_id", lecturerId)
    .order("created_at", { ascending: false });

  if (error) return fail("getMyFeedbackRequests", error);

  const rows = (data ?? []) as (Omit<
    FeedbackRequest,
    "course_ids" | "question_ids"
  > & {
    feedback_period_courses: { course_id: string }[] | null;
    feedback_period_questions: { question_id: string }[] | null;
  })[];

  return {
    ok: true,
    data: rows.map(
      ({ feedback_period_courses, feedback_period_questions, ...period }) => ({
        ...period,
        course_ids: (feedback_period_courses ?? []).map((c) => c.course_id),
        question_ids: (feedback_period_questions ?? []).map((q) => q.question_id),
      }),
    ),
  };
}

/** Replace a form's courses and questions with exactly what was chosen. */
async function setRequestContent(
  periodId: string,
  courseIds: string[],
  questionIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  await supabase
    .from("feedback_period_courses")
    .delete()
    .eq("feedback_period_id", periodId);
  await supabase
    .from("feedback_period_questions")
    .delete()
    .eq("feedback_period_id", periodId);

  const { error: courseError } = await supabase
    .from("feedback_period_courses")
    .insert(courseIds.map((course_id) => ({ feedback_period_id: periodId, course_id })));
  if (courseError) return requestFail("setRequestContent courses", courseError);

  const { error: questionError } = await supabase
    .from("feedback_period_questions")
    .insert(
      questionIds.map((question_id, i) => ({
        feedback_period_id: periodId,
        question_id,
        display_order: i + 1,
      })),
    );
  if (questionError) return requestFail("setRequestContent questions", questionError);

  return { ok: true };
}

/**
 * Raise a new request. Created as a pending draft — the insert policy accepts
 * nothing else, so there is no state in which a lecturer's form is live
 * without the department having seen it.
 *
 * If the courses or questions fail to attach, the period is removed again
 * rather than left behind: an empty form cannot be approved anyway, and it
 * would sit in the department's queue as a request nobody made.
 */
export async function createFeedbackRequest(
  draft: FeedbackRequestDraft,
  lecturerId: string,
  department: string,
  authUserId: string,
): Promise<Result<string>> {
  const { data, error } = await supabase
    .from("feedback_periods")
    .insert({
      title: draft.title,
      academic_year: draft.academic_year,
      semester: draft.semester,
      batch_year: draft.batch_year,
      department,
      feedback_type: draft.feedback_type,
      opens_at: draft.opens_at,
      closes_at: draft.closes_at,
      allow_editing: draft.allow_editing,
      status: "draft",
      approval_status: "pending",
      created_by: authUserId,
      created_by_lecturer_id: lecturerId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return requestFail("createFeedbackRequest", error ?? { message: "" });
  }

  const content = await setRequestContent(data.id, draft.course_ids, draft.question_ids);
  if (!content.ok) {
    await supabase.from("feedback_periods").delete().eq("id", data.id);
    return content;
  }
  return { ok: true, data: data.id };
}

export async function updateFeedbackRequest(
  periodId: string,
  draft: FeedbackRequestDraft,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("feedback_periods")
    .update({
      title: draft.title,
      academic_year: draft.academic_year,
      semester: draft.semester,
      batch_year: draft.batch_year,
      feedback_type: draft.feedback_type,
      opens_at: draft.opens_at,
      closes_at: draft.closes_at,
      allow_editing: draft.allow_editing,
      updated_at: new Date().toISOString(),
    })
    .eq("id", periodId);
  if (error) return requestFail("updateFeedbackRequest", error);

  const content = await setRequestContent(periodId, draft.course_ids, draft.question_ids);
  if (!content.ok) return content;
  return { ok: true, data: null };
}

/** Ask the department to look again after a rejection. */
export async function resubmitFeedbackRequest(
  periodId: string,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("feedback_periods")
    .update({ approval_status: "pending", updated_at: new Date().toISOString() })
    .eq("id", periodId);
  if (error) return requestFail("resubmitFeedbackRequest", error);
  return { ok: true, data: null };
}

/** Take back a request the department has not approved. */
export async function withdrawFeedbackRequest(
  periodId: string,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("feedback_periods")
    .delete()
    .eq("id", periodId);
  if (error) return requestFail("withdrawFeedbackRequest", error);
  return { ok: true, data: null };
}

/**
 * Move an approved form between draft, open and closed. The database refuses
 * to open anything the department has not approved, whatever is asked here.
 */
export async function setFeedbackRequestStatus(
  periodId: string,
  status: FeedbackPeriodStatus,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("feedback_periods")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", periodId);
  if (error) return requestFail("setFeedbackRequestStatus", error);
  return { ok: true, data: null };
}

export const submitOfferingResults = (offeringId: string) =>
  callWorkflow("submit_offering_results", { p_offering_id: offeringId });

export const returnOfferingResults = (offeringId: string, notes: string | null) =>
  callWorkflow("return_offering_results", {
    p_offering_id: offeringId,
    p_notes: notes,
  });

export const publishOfferingResults = (offeringId: string) =>
  callWorkflow("publish_offering_results", { p_offering_id: offeringId });
