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
  /** Null for a first-year who has not been divided into a department yet. */
  department: string | null;
  batch_year: number;
  cgpa: number | null;
  /** Null for a student nobody has been assigned to yet. */
  mentor_id: string | null;
  mentor_name: string | null;
  /** The mentor's own department. Differs from the student's when a student
   *  moved department and kept the mentor they already had. */
  mentor_department: string | null;
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
/* Conversation                                                        */
/* ------------------------------------------------------------------ */

export interface MessageAttachment {
  /** Storage key under the private bucket; signed on demand, never stored. */
  path: string;
  name: string;
  size: number;
  type: string | null;
}

export interface MentorMessage {
  id: string;
  sender_role: "student" | "mentor";
  /** Null for a message that is only a file. */
  body: string | null;
  sent_at: string;
  read_at: string | null;
  /** Whether the signed-in person wrote it. */
  mine: boolean;
  attachment: MessageAttachment | null;
  /**
   * Set only on a message this client has not yet had confirmed by the
   * server — it shows a clock instead of ticks. Never comes from the
   * database.
   */
  pending?: boolean;
}

export interface MentorThread {
  assignment_id: string;
  my_role: "student" | "mentor";
  /** False once the assignment has ended: readable, but nothing more can be said. */
  is_current: boolean;
  other: {
    name: string;
    email: string;
    role: "student" | "mentor";
    index_number?: string | null;
  };
  messages: MentorMessage[];
}

/**
 * The conversation for one assignment. Omit the student id and you get your
 * own, which is how a student asks.
 *
 * A thread belongs to an assignment rather than to a pair of people, so a
 * student who is reassigned starts a fresh conversation with the new mentor
 * and the old one keeps theirs. Null when the caller has no mentoring
 * relationship with that student at all.
 */
export async function getMentorThread(
  studentId?: string,
): Promise<Result<MentorThread | null>> {
  const { data, error } = await supabase.rpc("get_mentor_thread", {
    p_student_id: studentId ?? null,
  });
  if (error) return fail("get_mentor_thread", error);
  return {
    ok: true,
    data: ((data as { thread: MentorThread | null } | null)?.thread ??
      null) as MentorThread | null,
  };
}

export async function sendMentorMessage(
  body: string,
  studentId?: string,
  attachment?: MessageAttachment,
): Promise<Result<{ ok: boolean; message_id: string; sent_at: string }>> {
  const { data, error } = await supabase.rpc("send_mentor_message", {
    p_body: body || null,
    p_student_id: studentId ?? null,
    p_attachment_path: attachment?.path ?? null,
    p_attachment_name: attachment?.name ?? null,
    p_attachment_size: attachment?.size ?? null,
    p_attachment_type: attachment?.type ?? null,
  });
  if (error) return fail("send_mentor_message", error);
  return {
    ok: true,
    data: data as { ok: boolean; message_id: string; sent_at: string },
  };
}

/** One message in the shape the thread returns it, for a realtime row. */
export async function getMentorMessage(
  messageId: string,
): Promise<MentorMessage | null> {
  const { data, error } = await supabase.rpc("get_mentor_message", {
    p_message_id: messageId,
  });
  if (error) {
    console.error("[mentorService] get_mentor_message", error);
    return null;
  }
  return (data ?? null) as MentorMessage | null;
}

export const ATTACHMENT_BUCKET = "mentor-attachments";
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Puts a file in the conversation's own folder and hands back what the
 * message needs to reference it.
 *
 * The path leads with the assignment id because that is what the storage
 * policy checks — and what the send function re-checks, since the client
 * chose the path and a client's choice is not evidence.
 */
export async function uploadAttachment(
  assignmentId: string,
  file: File,
): Promise<Result<MessageAttachment>> {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: "That file is larger than 10 MB." };
  }
  // Keep the name readable but harmless: the original is stored alongside
  // for display, so the key itself only has to be unique and safe.
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `${assignmentId}/${crypto.randomUUID()}-${safe}`;

  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (error) return fail("upload attachment", error);

  return {
    ok: true,
    data: {
      path,
      name: file.name,
      size: file.size,
      type: file.type || null,
    },
  };
}

/** A short-lived link to one attachment, signed when the reader asks. */
export async function attachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, 3600);
  if (error) {
    console.error("[mentorService] signed url", error);
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function markThreadRead(studentId?: string): Promise<void> {
  const { error } = await supabase.rpc("mark_mentor_thread_read", {
    p_student_id: studentId ?? null,
  });
  if (error) console.error("[mentorService] mark_mentor_thread_read", error);
}

export interface MenteeUnread {
  student_id: string;
  unread: number;
  last_message_at: string | null;
}

/** Which of a mentor's conversations are waiting on them. */
export async function getMenteeUnread(): Promise<Result<MenteeUnread[]>> {
  const { data, error } = await supabase.rpc("my_mentee_unread");
  if (error) return fail("my_mentee_unread", error);
  return { ok: true, data: (data ?? []) as MenteeUnread[] };
}

/* ------------------------------------------------------------------ */
/* Private notes                                                       */
/* ------------------------------------------------------------------ */

export interface MentorNote {
  note_id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
  assignment_id: string;
  /** False for a note written while mentoring a student who has since moved. */
  written_while_current: boolean;
}

/**
 * The caller's own notes about one student.
 *
 * Private to whoever wrote them: not the head of department, not an admin,
 * and not the student. Gathered across every assignment the caller has had
 * with this student, so a mentor who loses a student and gets them back still
 * sees everything they themselves wrote.
 */
export async function getMentorNotes(
  studentId: string,
): Promise<Result<MentorNote[]>> {
  const { data, error } = await supabase.rpc("get_mentor_notes", {
    p_student_id: studentId,
  });
  if (error) return fail("get_mentor_notes", error);
  return { ok: true, data: (data ?? []) as MentorNote[] };
}

/** Omit noteId to add; pass one of your own to rewrite it. */
export async function saveMentorNote(
  studentId: string,
  body: string,
  noteId?: string,
): Promise<Result<{ ok: boolean; note_id: string; message: string }>> {
  const { data, error } = await supabase.rpc("save_mentor_note", {
    p_student_id: studentId,
    p_body: body,
    p_note_id: noteId ?? null,
  });
  if (error) return fail("save_mentor_note", error);
  return { ok: true, data: data as { ok: boolean; note_id: string; message: string } };
}

export async function deleteMentorNote(
  noteId: string,
): Promise<Result<{ ok: boolean; message: string }>> {
  const { data, error } = await supabase.rpc("delete_mentor_note", {
    p_note_id: noteId,
  });
  if (error) return fail("delete_mentor_note", error);
  return { ok: true, data: data as { ok: boolean; message: string } };
}

export interface MenteeNoteCount {
  student_id: string;
  notes: number;
}

export async function getMenteeNoteCounts(): Promise<
  Result<MenteeNoteCount[]>
> {
  const { data, error } = await supabase.rpc("my_mentee_note_counts");
  if (error) return fail("my_mentee_note_counts", error);
  return { ok: true, data: (data ?? []) as MenteeNoteCount[] };
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
