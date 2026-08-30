import { supabase } from "./supabase";

/**
 * Data layer for academic mentoring.
 *
 * Three parties read the same allocation from different ends: a student sees
 * the one lecturer assigned to them, a mentor sees their own students, and a
 * head of department sees the whole department's allocation. Every call goes
 * through a SECURITY DEFINER function that works out which of those the
 * caller is — a lecturer has no RLS grant on `students`, so none of this can
 * be assembled client-side.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(
  context: string,
  error: { message: string },
): { ok: false; error: string } {
  console.error(`[mentorService] ${context}`, error);
  return { ok: false, error: error.message };
}

/* ------------------------------------------------------------------ */
/* Student side                                                        */
/* ------------------------------------------------------------------ */

export interface MyMentor {
  assignment_id: string;
  assigned_at: string;
  mentor_id: string;
  /** Title and name together, as it should be shown. */
  name: string;
  plain_name: string;
  title: string | null;
  email: string;
  department: string;
  staff_no: string | null;
  is_hod: boolean;
}

/** Null when the department has not assigned this student a mentor yet. */
export async function getMyMentor(): Promise<Result<MyMentor | null>> {
  const { data, error } = await supabase.rpc("get_my_mentor");
  if (error) return fail("get_my_mentor", error);
  return { ok: true, data: (data ?? null) as MyMentor | null };
}

/* ------------------------------------------------------------------ */
/* Mentor side                                                         */
/* ------------------------------------------------------------------ */

/**
 * Which of a mentor's students to look at first. Worked out server-side from
 * the faculty's own thresholds rather than chosen here, so the bands move
 * when the faculty moves them.
 */
export type RiskBand =
  | "at_risk"
  | "needs_attention"
  | "attendance_concern"
  | "good";

export interface Mentee {
  student_id: string;
  name: string;
  index_number: string | null;
  reg_number: string | null;
  email: string;
  department: string;
  batch_year: number;
  assigned_at: string;
  latest_semester: number;
  cgpa: number | null;
  credits_earned: number;
  latest_sgpa: number | null;
  latest_sgpa_semester: number | null;
  modules_passed: number;
  modules_failed: number;
  modules_repeat: number;
  modules_medical: number;
  /** Null when no attendance has been recorded for them at all. */
  attendance_pct: number | null;
  risk_band: RiskBand;
}

export async function getMyMentees(): Promise<Result<Mentee[]>> {
  const { data, error } = await supabase.rpc("get_my_mentees");
  if (error) return fail("get_my_mentees", error);
  return { ok: true, data: (data ?? []) as Mentee[] };
}

export interface OverviewCourse {
  course_code: string;
  title: string;
  credits: number;
  contributes_to_gpa: boolean;
  grade: string | null;
  gpv: number | null;
}

export interface OverviewSemester {
  semester: number;
  academic_year: string | null;
  /** Null for a semester whose courses none of them count towards the GPA. */
  sgpa: number | null;
  credits: number;
  courses: OverviewCourse[];
}

export interface MenteeOverview {
  student: {
    student_id: string;
    name: string;
    index_number: string | null;
    reg_number: string | null;
    email: string;
    department: string;
    batch_year: number;
  };
  mentor: {
    mentor_id: string;
    name: string;
    email: string;
    assigned_at: string;
  } | null;
  cgpa: number | null;
  credits_earned: number;
  modules: { passed: number; failed: number; repeat: number; medical: number };
  attendance: { present: number; total: number; pct: number | null };
  semesters: OverviewSemester[];
}

/** One student's whole degree, for the mentor who has them now. */
export async function getMenteeOverview(
  studentId: string,
): Promise<Result<MenteeOverview>> {
  const { data, error } = await supabase.rpc("get_mentee_academic_overview", {
    p_student_id: studentId,
  });
  if (error) return fail("get_mentee_academic_overview", error);
  return { ok: true, data: data as MenteeOverview };
}

/* ------------------------------------------------------------------ */
/* Head of department side                                             */
/* ------------------------------------------------------------------ */

export interface MentorRosterRow {
  student_id: string;
  name: string;
  index_number: string | null;
  reg_number: string | null;
  email: string;
  department: string;
  batch_year: number;
  cgpa: number | null;
  /** Null for a student nobody has been assigned to yet. */
  mentor_id: string | null;
  mentor_name: string | null;
  assigned_at: string | null;
}

export async function getMentorRoster(): Promise<Result<MentorRosterRow[]>> {
  const { data, error } = await supabase.rpc("get_department_mentor_roster");
  if (error) return fail("get_department_mentor_roster", error);
  return { ok: true, data: (data ?? []) as MentorRosterRow[] };
}

export interface MentorAllocation {
  mentor_id: string;
  mentor_name: string;
  email: string;
  is_hod: boolean;
  total: number;
  /** Batch year as the key, headcount as the value. */
  by_batch: Record<string, number>;
}

export async function getMentorAllocations(): Promise<
  Result<MentorAllocation[]>
> {
  const { data, error } = await supabase.rpc(
    "get_department_mentor_allocations",
  );
  if (error) return fail("get_department_mentor_allocations", error);
  return { ok: true, data: (data ?? []) as MentorAllocation[] };
}

export interface MentorHistoryRow {
  assignment_id: string;
  mentor_id: string;
  mentor_name: string;
  assigned_at: string;
  ended_at: string | null;
  end_reason: string | null;
  assigned_by_name: string | null;
  notes: string | null;
  is_current: boolean;
}

export async function getMentorHistory(
  studentId: string,
): Promise<Result<MentorHistoryRow[]>> {
  const { data, error } = await supabase.rpc("get_student_mentor_history", {
    p_student_id: studentId,
  });
  if (error) return fail("get_student_mentor_history", error);
  return { ok: true, data: (data ?? []) as MentorHistoryRow[] };
}

export interface MentorOutcome {
  ok: boolean;
  changed: boolean;
  message: string;
}

/** Ends any current assignment and opens a new one, in one transaction. */
export async function assignMentor(
  studentId: string,
  mentorId: string,
  note?: string,
): Promise<Result<MentorOutcome>> {
  const { data, error } = await supabase.rpc("assign_student_mentor", {
    p_student_id: studentId,
    p_mentor_id: mentorId,
    p_note: note ?? null,
  });
  if (error) return fail("assign_student_mentor", error);
  return { ok: true, data: data as MentorOutcome };
}

export async function clearMentor(
  studentId: string,
  reason?: string,
): Promise<Result<MentorOutcome>> {
  const { data, error } = await supabase.rpc("clear_student_mentor", {
    p_student_id: studentId,
    p_reason: reason ?? null,
  });
  if (error) return fail("clear_student_mentor", error);
  return { ok: true, data: data as MentorOutcome };
}

/* ------------------------------------------------------------------ */
/* Shared presentation                                                 */
/* ------------------------------------------------------------------ */

export const RISK_LABEL: Record<RiskBand, string> = {
  at_risk: "At risk",
  needs_attention: "Needs attention",
  attendance_concern: "Attendance concern",
  good: "Good standing",
};

export const RISK_TONE: Record<
  RiskBand,
  "danger" | "warning" | "info" | "success"
> = {
  at_risk: "danger",
  needs_attention: "warning",
  attendance_concern: "info",
  good: "success",
};

/** Why a student carries the band they do, in the words a mentor would use. */
export const RISK_REASON: Record<RiskBand, string> = {
  at_risk: "CGPA is below the Pass classification",
  needs_attention: "carrying failed, repeat or medical modules",
  attendance_concern: "attendance is below the Handbook requirement",
  good: "no academic concerns flagged",
};
