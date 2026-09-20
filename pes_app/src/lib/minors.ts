import { supabase } from "./supabase";

/**
 * A department's minor specialisations.
 *
 * A minor lives in two places — the stream a course is tagged with, and the
 * credits it takes — joined only by its name. Renaming or removing one
 * therefore has to touch both, so those two go through the database rather
 * than being done here in two writes that could half-succeed.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(where: string, error: { message?: string } | null): { ok: false; error: string } {
  console.error(`[minors] ${where}`, error);
  return {
    ok: false,
    error: error?.message ?? "Something went wrong. Please try again.",
  };
}

export interface MinorCourse {
  course_id: string;
  course_code: string;
  title: string;
  credits: number;
  semester: number;
}

export interface DepartmentMinor {
  minor: string;
  required_credits: number;
  tagged_courses: number;
  tagged_credits: number;
  courses: MinorCourse[];
}

export async function getDepartmentMinors(
  department: string,
): Promise<Result<DepartmentMinor[]>> {
  const { data, error } = await supabase.rpc("get_department_minors", {
    p_department: department,
  });
  if (error) return fail("get_department_minors", error);
  return { ok: true, data: (data ?? []) as DepartmentMinor[] };
}

export async function addMinor(
  department: string,
  minor: string,
  requiredCredits: number,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("minor_requirements")
    .insert({ department, minor: minor.trim(), required_credits: requiredCredits });
  if (error) return fail("addMinor", error);
  return { ok: true, data: null };
}

export async function setMinorCredits(
  department: string,
  minor: string,
  requiredCredits: number,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("minor_requirements")
    .update({ required_credits: requiredCredits })
    .eq("department", department)
    .eq("minor", minor);
  if (error) return fail("setMinorCredits", error);
  return { ok: true, data: null };
}

/** Renames the stream and retags its courses in one go. */
export async function renameMinor(
  department: string,
  from: string,
  to: string,
): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("rename_minor", {
    p_department: department,
    p_from: from,
    p_to: to,
  });
  if (error) return fail("rename_minor", error);
  return { ok: true, data: (data as { message?: string })?.message ?? "Renamed." };
}

/** Removes the stream and untags its courses, which stay in the catalogue. */
export async function deleteMinor(
  department: string,
  minor: string,
): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("delete_minor", {
    p_department: department,
    p_minor: minor,
  });
  if (error) return fail("delete_minor", error);
  return { ok: true, data: (data as { message?: string })?.message ?? "Removed." };
}
