import { supabase } from "./supabase";

/**
 * Registry actions on a student's record — the ones that change what cohort
 * a student belongs to rather than what they scored.
 *
 * Every one goes through a SECURITY DEFINER function that writes the audit
 * row and the record change together. `students.batch_year` additionally has
 * a trigger refusing any direct UPDATE, so there is no path that changes a
 * batch without leaving a trace.
 */

export interface BatchChange {
  id: string;
  from_batch_year: number;
  to_batch_year: number;
  reason: string | null;
  reference: string | null;
  changed_at: string;
  changed_by_name: string;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function changeStudentBatch(
  studentId: string,
  toBatchYear: number,
  reason: string | null,
  reference: string | null,
): Promise<Result<{ ok: boolean; message: string }>> {
  const { data, error } = await supabase.rpc("change_student_batch", {
    p_student_id: studentId,
    p_to_batch_year: toBatchYear,
    p_reason: reason,
    p_reference: reference,
  });
  if (error) {
    console.error("[registryService] change_student_batch", error);
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    data: { ok: Boolean(data?.ok), message: data?.message ?? "Done." },
  };
}

/* ------------------------------------------------------------------ */
/* Moving a student to another department (Super Admin)                 */
/* ------------------------------------------------------------------ */

export interface DepartmentChange {
  from_department: string | null;
  to_department: string | null;
  reason: string | null;
  changed_at: string;
  changed_by_name: string;
}

/** What the Super Admin sees before moving a student. */
export interface StudentDepartmentPreview {
  name: string;
  department: string | null;
  mentor_name: string | null;
  mentor_department: string | null;
  minor: string | null;
  minor_department: string | null;
  history: DepartmentChange[];
}

export async function getStudentDepartmentPreview(
  studentId: string,
): Promise<Result<StudentDepartmentPreview>> {
  const { data, error } = await supabase.rpc("admin_student_department_preview", {
    p_student_id: studentId,
  });
  if (error) {
    console.error("[registryService] admin_student_department_preview", error);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: data as StudentDepartmentPreview };
}

export async function changeStudentDepartment(
  studentId: string,
  department: string,
  reason: string,
): Promise<Result<{ ok: boolean; message: string }>> {
  const { data, error } = await supabase.rpc("admin_change_student_department", {
    p_student_id: studentId,
    p_department: department,
    p_reason: reason,
  });
  if (error) {
    console.error("[registryService] admin_change_student_department", error);
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    data: { ok: Boolean(data?.ok), message: data?.message ?? "Done." },
  };
}

export async function getStudentBatchHistory(
  studentId: string,
): Promise<Result<BatchChange[]>> {
  const { data, error } = await supabase.rpc("get_student_batch_history", {
    p_student_id: studentId,
  });
  if (error) {
    console.error("[registryService] get_student_batch_history", error);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: (data ?? []) as BatchChange[] };
}
