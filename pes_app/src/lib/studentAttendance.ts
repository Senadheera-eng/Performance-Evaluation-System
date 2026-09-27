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

  /* An RPC result is cast, not checked, so a field the database stops
     sending is `undefined` here and typed as though it were not. A page that
     maps over one then takes the whole route down with it — which is exactly
     what a missing `sessions` did. Filling the gaps once, here, keeps that
     from being every caller's problem. */
  const payload = (data ?? {}) as Partial<MyAttendance>;
  return {
    ok: true,
    data: {
      threshold_percent: payload.threshold_percent ?? 80,
      prewarning_percent: payload.prewarning_percent ?? 85,
      deliveries: (payload.deliveries ?? []).map((d) => ({
        ...d,
        sessions: d.sessions ?? [],
      })),
    },
  };
}

/** "CO4204" for a course sat once, "CO4204 · attempt 2" for a repeat. */
export function deliveryLabel(d: CourseDelivery): string {
  return d.has_repeat ? `${d.course_code} · attempt ${d.attempt_number}` : d.course_code;
}

/** A teaching term: an academic year and the semester taught in it. */
export interface Term {
  academicYear: string;
  /** The highest semester being sat, which names the term ("Semester 7"). */
  semester: number | null;
}

/**
 * The deliveries of the term the student is in now, and that term.
 *
 * An enrolment is never moved on from "enrolled" when its term ends, so
 * `in_progress` cannot say which courses are current: once a student enrols
 * for semester 8 their semester 7 courses are still "enrolled" too. The term
 * is read from the record instead. Each academic year teaches two semesters,
 * odd first and even second, so the current term is the latest academic
 * year the student has a delivery in, and within it the even half once any
 * even-semester course has begun. A repeat is sat alongside the batch it
 * joined, in the same half of the year as the course's own semester, so a
 * semester 5 module repeated during semester 7 is current and counted.
 *
 * Earlier terms are left out entirely: their registers are closed, and a
 * row of 100%s from two years ago only buried the courses that still count.
 */
export function currentTermDeliveries(deliveries: CourseDelivery[]): {
  term: Term | null;
  deliveries: CourseDelivery[];
} {
  if (deliveries.length === 0) return { term: null, deliveries: [] };

  // "2024/2025" strings order correctly as text.
  const latestYear = deliveries.reduce(
    (max, d) => (d.academic_year > max ? d.academic_year : max),
    deliveries[0].academic_year,
  );
  const inYear = deliveries.filter((d) => d.academic_year === latestYear);
  const secondHalf = inYear.some((d) => d.semester !== null && d.semester % 2 === 0);
  const current = inYear.filter(
    (d) => d.semester === null || (d.semester % 2 === 0) === secondHalf,
  );

  const semesters = current
    .filter((d) => !d.is_repeat && d.semester !== null)
    .map((d) => d.semester as number);

  return {
    term: {
      academicYear: latestYear,
      semester: semesters.length > 0 ? Math.max(...semesters) : null,
    },
    deliveries: current,
  };
}

/** "Semester 7 · 2024/2025", or just the year when the semester is unknown. */
export function termLabel(term: Term): string {
  return term.semester !== null
    ? `Semester ${term.semester} · ${term.academicYear}`
    : term.academicYear;
}
