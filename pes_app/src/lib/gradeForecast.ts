import { supabase } from "./supabase";

/**
 * Grade forecasts from the machine-learning model (ml/train.py).
 *
 * The model reads each student's grades so far and predicts, for each course
 * of the coming semester, the grade band they are likely to get. Predictions
 * live in the database and are read through three functions, each deciding
 * who may ask:
 *
 * - get_my_grade_forecast: a student's own, with likely bands and a forecast
 *   SGPA but no chance of an R or F (that is for their mentor to raise);
 * - get_mentee_early_warnings: a mentor's mentees, likeliest to need a word
 *   first;
 * - get_student_grade_forecast: one student's full forecast, for their mentor
 *   or anyone who may see their record.
 *
 * Each returns nothing when no model is loaded or the student has no
 * forecast, and the cards that use them then stay out of the way.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(context: string, error: { message: string }): { ok: false; error: string } {
  console.error(`[gradeForecast] ${context}`, error);
  return { ok: false, error: error.message };
}

export const BANDS = ["A+/A", "A-/B+", "B/B-", "C+/C", "R/F"] as const;
export type Band = (typeof BANDS)[number];

/** One model's scores on a semester it was not trained on (ml/report). */
export interface EvaluationRow {
  model: string;
  accuracy: number;
  within_one_band: number;
  sgpa_mae: number;
  sgpa_within_0_25?: number;
  student_risk_auc?: number | null;
  top25_flag_recall?: number | null;
}

export interface ForecastModel {
  name: string;
  algorithm: string;
  trained_at: string;
  train_rows: number;
  /** Keyed by the held-out semester. */
  evaluation: Record<string, { train_rows: number; test_rows: number; results: EvaluationRow[] }>;
}

/** How the deployed model did on the latest semester it was tested on. */
export function modelCheck(model: ForecastModel): (EvaluationRow & { semester: number }) | null {
  const semesters = Object.keys(model.evaluation).map(Number).filter(Number.isFinite);
  if (semesters.length === 0) return null;
  const semester = Math.max(...semesters);
  const rows = model.evaluation[String(semester)]?.results ?? [];
  const row = rows.find((r) => r.model === "Random forest") ?? rows[rows.length - 1];
  return row ? { ...row, semester } : null;
}

/** Enrolled courses, or (before enrolling) the department's compulsory ones. */
export type ForecastBasis = "enrolled" | "compulsory";

export interface MyForecastCourse {
  course_id: string;
  course_code: string;
  title: string;
  credits: number;
  counts_this_semester: boolean;
  /** True where R/F is the likeliest band; then band and chance are null. */
  needs_attention: boolean;
  band: Band | null;
  chance: number | null;
}

export interface MyGradeForecast {
  model: ForecastModel;
  semester: number;
  basis: ForecastBasis;
  forecast_sgpa: number | null;
  reasons: string[];
  courses: MyForecastCourse[];
}

export async function getMyGradeForecast(): Promise<Result<MyGradeForecast | null>> {
  const { data, error } = await supabase.rpc("get_my_grade_forecast");
  if (error) return fail("get_my_grade_forecast", error);
  return { ok: true, data: (data ?? null) as MyGradeForecast | null };
}

/** high: a 40% or greater chance of at least one R or F; watch: 25%. */
export type WarningLevel = "high" | "watch" | "low";

export interface WatchCourse {
  course_code: string;
  title: string;
  band: Band;
  at_risk: number;
}

export interface MenteeWarning {
  student_id: string;
  name: string;
  index_number: string | null;
  department: string;
  batch_year: number;
  semester: number;
  forecast_sgpa: number | null;
  /** The chance of at least one R or F this semester. */
  risk: number;
  level: WarningLevel;
  /** Courses with at least twice the usual chance of an R or F. */
  watch_courses: WatchCourse[];
  reasons: string[];
  basis: ForecastBasis;
}

export async function getMenteeEarlyWarnings(): Promise<Result<MenteeWarning[]>> {
  const { data, error } = await supabase.rpc("get_mentee_early_warnings");
  if (error) return fail("get_mentee_early_warnings", error);
  return { ok: true, data: (data ?? []) as MenteeWarning[] };
}

export interface StudentForecastCourse {
  course_id: string;
  course_code: string;
  title: string;
  credits: number;
  counts_this_semester: boolean;
  band: Band;
  probabilities: Record<Band, number>;
  expected_gpv: number;
  at_risk: number;
  watch: boolean;
}

export interface StudentGradeForecast {
  model: ForecastModel;
  semester: number;
  basis: ForecastBasis;
  forecast_sgpa: number | null;
  risk: number;
  level: WarningLevel;
  reasons: string[];
  courses: StudentForecastCourse[];
}

export async function getStudentGradeForecast(
  studentId: string,
): Promise<Result<StudentGradeForecast | null>> {
  const { data, error } = await supabase.rpc("get_student_grade_forecast", {
    p_student_id: studentId,
  });
  if (error) return fail("get_student_grade_forecast", error);
  return { ok: true, data: (data ?? null) as StudentGradeForecast | null };
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
