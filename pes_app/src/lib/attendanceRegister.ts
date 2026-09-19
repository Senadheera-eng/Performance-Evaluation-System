import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import type { AttendanceStatus } from "./staffService";

/**
 * Attendance as the department office sees it.
 *
 * Everything here is keyed on the offering — the course as taught to one
 * batch in one year — which is also what the lecturer's sheet is keyed on.
 * The admin page used to work by course and date instead, which quietly
 * gave it a different class list and let it write rows the lecturer's sheet
 * could not see. Using the same key is what keeps the two in step.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(where: string, error: { message?: string } | null): { ok: false; error: string } {
  console.error(`[attendance] ${where}`, error);
  return { ok: false, error: error?.message ?? "Something went wrong. Please try again." };
}

/** A calendar date in the viewer's own time zone, as `YYYY-MM-DD`.
 *  `toISOString()` gives the UTC date, which in Sri Lanka is still
 *  yesterday until 5:30 in the morning. */
export function localDateISO(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface AttendanceOffering {
  offering_id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  semester: number;
  academic_year: string;
  batch_year: number;
  department: string;
  student_count: number;
  lectures_held: number;
  last_lecture: string | null;
  /** The batch is in this course's semester right now. */
  is_current: boolean;
}

export async function getAttendanceOfferings(): Promise<Result<AttendanceOffering[]>> {
  const { data, error } = await supabase.rpc("get_attendance_offerings");
  if (error) return fail("get_attendance_offerings", error);
  return { ok: true, data: (data ?? []) as AttendanceOffering[] };
}

export interface StudentAttendanceSummary {
  student_id: string;
  name: string;
  index_number: string | null;
  reg_number: string | null;
  batch_year: number;
  is_repeat: boolean;
  present: number;
  absent: number;
  excused: number;
  /** Lectures recorded for the whole class, not just this student. */
  lectures_held: number;
  last_marked: string | null;
}

export async function getOfferingAttendanceSummary(
  offeringId: string,
): Promise<Result<StudentAttendanceSummary[]>> {
  const { data, error } = await supabase.rpc("get_offering_attendance_summary", {
    p_offering_id: offeringId,
  });
  if (error) return fail("get_offering_attendance_summary", error);
  return { ok: true, data: (data ?? []) as StudentAttendanceSummary[] };
}

export interface SessionMark {
  student_id: string;
  status: AttendanceStatus;
  method: "manual" | "qr";
}

/** Every mark for one lecture of one offering. */
export async function getSessionMarks(
  offeringId: string,
  lectureDate: string,
): Promise<Result<SessionMark[]>> {
  const { data, error } = await supabase
    .from("attendance")
    .select("student_id, status, method")
    .eq("offering_id", offeringId)
    .eq("lecture_date", lectureDate);
  if (error) return fail("getSessionMarks", error);
  return { ok: true, data: (data ?? []) as SessionMark[] };
}

/** The dates that have at least one mark, newest first. */
export async function getLectureDates(offeringId: string): Promise<Result<string[]>> {
  const { data, error } = await supabase
    .from("attendance")
    .select("lecture_date")
    .eq("offering_id", offeringId);
  if (error) return fail("getLectureDates", error);
  const dates = [...new Set((data ?? []).map((r) => r.lecture_date as string))];
  return { ok: true, data: dates.sort().reverse() };
}

/**
 * Save one lecture's register as edited: marks are written, and a mark that
 * was taken away is removed rather than left behind. Both go out together;
 * the database fills in who recorded each change.
 */
export async function saveSession(
  offeringId: string,
  courseId: string,
  lectureDate: string,
  marks: { student_id: string; status: AttendanceStatus }[],
  cleared: string[],
): Promise<Result<{ saved: number; cleared: number }>> {
  if (marks.length > 0) {
    const { error } = await supabase.from("attendance").upsert(
      marks.map((m) => ({
        student_id: m.student_id,
        course_id: courseId,
        offering_id: offeringId,
        lecture_date: lectureDate,
        status: m.status,
      })),
      { onConflict: "student_id,course_id,lecture_date" },
    );
    if (error) return fail("saveSession", error);
  }
  if (cleared.length > 0) {
    const { error } = await supabase
      .from("attendance")
      .delete()
      .eq("offering_id", offeringId)
      .eq("lecture_date", lectureDate)
      .in("student_id", cleared);
    if (error) return fail("saveSession.clear", error);
  }
  return { ok: true, data: { saved: marks.length, cleared: cleared.length } };
}

/** How long after this page's own save its echoes are still arriving. */
export const OWN_WRITE_ECHO_MS = 3000;

/**
 * Call `onChange` whenever anyone changes attendance for this offering —
 * a lecturer saving their sheet, a register closing, the office correcting
 * a mark — so an open page is never showing yesterday's register.
 *
 * Row security decides which changes arrive, so this cannot leak another
 * department's register. Changes come in bursts (a whole class at once),
 * so they are coalesced into one refresh.
 */
export function useAttendanceLive(
  offeringId: string | null,
  onChange: () => void,
): void {
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    if (!offeringId) return;
    let timer: number | null = null;
    const fire = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        callback.current();
      }, 400);
    };

    const channel = supabase
      .channel(`attendance:${offeringId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attendance",
          filter: `offering_id=eq.${offeringId}`,
        },
        fire,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "attendance",
          filter: `offering_id=eq.${offeringId}`,
        },
        fire,
      )
      /* A delete cannot be filtered by column (the event carries only the
         row's id), so any removed mark prompts a refresh. They are rare —
         a mark taken back — so the extra reload costs nothing. */
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "attendance" },
        fire,
      )
      .subscribe();

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [offeringId]);
}
