import { supabase } from "./supabase";
import { MARK_MAX } from "./resultsWorkbook";

/**
 * Changing a result that is already published (change_published_result).
 *
 * The Super Admin can change any result; a Department Admin or Head of
 * Department only those in courses their department owns. The database
 * decides that, needs a reason, keeps the marks and grade before and after
 * in result_changes, and tells the student. A re-sit stays capped at C
 * unless the change says the earlier R or F was recorded in error.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ResultChange {
  changed_at: string;
  changed_by_name: string;
  reason: string;
  recorded_in_error: boolean;
  old_mid_sem: number | null;
  old_ca: number | null;
  old_grade: string | null;
  new_mid_sem: number | null;
  new_ca: number | null;
  new_grade: string | null;
}

export interface ChangeOutcome {
  /** False when nothing differed from what is recorded. */
  changed: boolean;
  message: string;
  grade: string | null;
  capped: boolean;
}

export async function changePublishedResult(
  resultId: string,
  midSem: number | null,
  ca: number | null,
  grade: string,
  reason: string,
  recordedInError: boolean,
): Promise<Result<ChangeOutcome>> {
  const { data, error } = await supabase.rpc("change_published_result", {
    p_result_id: resultId,
    p_mid_sem: midSem,
    p_ca: ca,
    p_grade: grade,
    p_reason: reason,
    p_recorded_in_error: recordedInError,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: {
      changed: Boolean(data?.ok),
      message: String(data?.message ?? "Saved."),
      grade: data?.grade ?? null,
      capped: Boolean(data?.capped),
    },
  };
}

export async function getResultChanges(resultId: string): Promise<Result<ResultChange[]>> {
  const { data, error } = await supabase.rpc("get_result_changes", { p_result_id: resultId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as ResultChange[] };
}

/** Grades that mean the course has to be taken again. */
export const RETAKE_GRADES = ["R", "F", "L"] as const;

export function mustRetake(grade: string | null | undefined): boolean {
  return !!grade && (RETAKE_GRADES as readonly string[]).includes(grade.toUpperCase());
}

/**
 * Does the re-sit cap bear on this result? It does when the student re-sat
 * after an R or repeated after an F: the database then records any grade
 * above C as C, unless the change says that R or F was recorded in error.
 */
export function resitCapApplies(grade: string | null | undefined, originalGrade: string | null | undefined): boolean {
  return [grade, originalGrade].some((g) => g === "R" || g === "F");
}

/** A mark as typed: empty is "not recorded"; otherwise a number within its limit. */
export function parseMark(value: string, field: keyof typeof MARK_MAX): { value: number | null; error?: string } {
  const text = value.trim();
  if (text === "") return { value: null };
  const n = Number(text);
  if (!Number.isFinite(n)) return { value: null, error: "Not a number" };
  if (n < 0 || n > MARK_MAX[field]) return { value: null, error: `0–${MARK_MAX[field]}` };
  return { value: n };
}

/** "Mid 32 → 35, grade B → B+" — what one change did, in a line. */
export function describeChange(c: Pick<ResultChange, "old_mid_sem" | "new_mid_sem" | "old_ca" | "new_ca" | "old_grade" | "new_grade">): string {
  const parts: string[] = [];
  const show = (v: number | null) => (v === null ? "—" : String(v));
  if (c.old_mid_sem !== c.new_mid_sem) parts.push(`Mid ${show(c.old_mid_sem)} → ${show(c.new_mid_sem)}`);
  if (c.old_ca !== c.new_ca) parts.push(`CA ${show(c.old_ca)} → ${show(c.new_ca)}`);
  if (c.old_grade !== c.new_grade) parts.push(`grade ${c.old_grade ?? "—"} → ${c.new_grade ?? "—"}`);
  return parts.length ? parts.join(", ") : "Marked as recorded in error";
}

/**
 * A semester's GPA from its published results: grade points weighted by
 * credits, over the courses that count toward the GPA and still carry a
 * grade point (an attempt a later one superseded carries none).
 */
export function semesterGpa(
  rows: { gpv: number | null; credits: number; contributesToGpa: boolean; published: boolean }[],
): number | null {
  let points = 0;
  let credits = 0;
  for (const r of rows) {
    if (!r.published || !r.contributesToGpa || r.gpv === null || r.credits <= 0) continue;
    points += r.gpv * r.credits;
    credits += r.credits;
  }
  return credits > 0 ? points / credits : null;
}
