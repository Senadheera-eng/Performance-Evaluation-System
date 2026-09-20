import { supabase } from "./supabase";

/**
 * This student's attendance, one entry per delivery of a course.
 *
 * A course a student repeats is sat twice, with its own register each time,
 * so it arrives here twice: once per attempt, each with its own lectures and
 * its own percentage. Only the latest attempt counts towards eligibility —
 * the earlier one is the record of a term that has been and gone.
 *
 * The register is read by the database rather than assembled here: which
 * lectures belong to which delivery is a question about offerings, and
 * answering it in the client meant fetching every row the student had ever
 * been marked for and hoping none of them collided.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface AttendanceSession {
  date: string;
  status: "present" | "absent" | "excused";
}

export interface CourseDelivery {
  /** Unique per attempt, unlike the course id, which a repeat shares. */
  delivery_key: string;
  course_id: string;
  course_code: string;
  title: string;
  semester: number | null;
  academic_year: string;
  /** The batch this delivery was taught to, which a repeat sits with. */
  enrolled_with_batch: number | null;
  is_repeat: boolean;
  attempt_number: number;
  /** Nothing has replaced it, so this is the attempt eligibility is judged on. */
  is_latest_attempt: boolean;
  /** The student has sat this course more than once. */
  has_repeat: boolean;
  /** Still being taught, rather than a term already completed. */
  in_progress: boolean;
  present: number;
  absent: number;
  excused: number;
  lectures: number;
  percentage: number | null;
  sessions: AttendanceSession[];
}

export interface MyAttendance {
  threshold_percent: number;
  prewarning_percent: number;
  deliveries: CourseDelivery[];
}

export async function getMyAttendance(): Promise<Result<MyAttendance>> {
  const { data, error } = await supabase.rpc("get_my_attendance_detail");
  if (error) {
    console.error("[attendance] get_my_attendance_detail", error);
    return {
      ok: false,
      error: "We could not load your attendance records. Please try again.",
    };
  }
  return { ok: true, data: data as MyAttendance };
}

/** "CO4204" for a course sat once, "CO4204 · attempt 2" for a repeat. */
export function deliveryLabel(d: CourseDelivery): string {
  return d.has_repeat ? `${d.course_code} · attempt ${d.attempt_number}` : d.course_code;
}
