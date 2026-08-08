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
  ese_mark: number | null;
  oa_mark: number | null;
  grade: string | null;
  gpv: number | null;
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

export const submitOfferingResults = (offeringId: string) =>
  callWorkflow("submit_offering_results", { p_offering_id: offeringId });

export const returnOfferingResults = (offeringId: string, notes: string | null) =>
  callWorkflow("return_offering_results", {
    p_offering_id: offeringId,
    p_notes: notes,
  });

export const publishOfferingResults = (offeringId: string) =>
  callWorkflow("publish_offering_results", { p_offering_id: offeringId });
