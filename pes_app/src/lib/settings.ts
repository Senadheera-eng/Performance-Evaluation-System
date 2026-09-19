import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Regulation engine.
 *
 * Every academic rule the system enforces — attendance thresholds, credit
 * requirements, the grading scale, department names — lives in the
 * `system_settings` table rather than as a constant in code, so the system
 * can be reconfigured for another faculty without a redeploy.
 *
 * The defaults below mirror the Faculty of Engineering (USJ) regulations and
 * are used as a fallback if the table can't be read, so behaviour degrades to
 * exactly what it was before this module existed rather than to zeroes.
 */

export interface GradeBoundary {
  grade: string;
  min_oa: number;
}

export interface HonoursClassification {
  key: string;
  label: string;
  threshold: number;
}

export interface Settings {
  attendanceThreshold: number;
  attendancePrewarningThreshold: number;
  graduationTotalCredits: number;
  totalSemesters: number;
  firstBatchIntakeYear: number;
  medicalSubmissionDeadlineDays: number;
  feedbackTextMaxLength: number;
  feedbackMinResponsesForAnalytics: number;
  studentDepartments: string[];
  interdisciplinaryDepartment: string;
  gpvScale: Record<string, number>;
  gradeBoundaries: GradeBoundary[];
  /** Faculty default split for a new course; a course carries its own. */
  oaWeights: { ca: number; ese: number };
  honoursClassifications: HonoursClassification[];
}

export const DEFAULT_SETTINGS: Settings = {
  attendanceThreshold: 80,
  attendancePrewarningThreshold: 85,
  graduationTotalCredits: 144,
  totalSemesters: 8,
  firstBatchIntakeYear: 2015,
  medicalSubmissionDeadlineDays: 14,
  feedbackTextMaxLength: 1500,
  feedbackMinResponsesForAnalytics: 5,
  studentDepartments: [
    "Civil Engineering",
    "Computer Engineering",
    "Electrical and Electronic Engineering",
    "Mechanical Engineering",
  ],
  interdisciplinaryDepartment: "Interdisciplinary Studies",
  gpvScale: {
    "A+": 4.0,
    A: 4.0,
    "A-": 3.7,
    "B+": 3.3,
    B: 3.0,
    "B-": 2.7,
    "C+": 2.3,
    C: 2.0,
    // The handbook's table ends at C: "Any grade 'C' and above (GPV >= 2.0) is
    // considered as a Pass grade." There is no C-, D+ or D in this faculty.
    F: 0.0,
    R: 0.0,
    L: 0.0,
  },
  gradeBoundaries: [
    { grade: "A+", min_oa: 85 },
    { grade: "A", min_oa: 75 },
    { grade: "A-", min_oa: 70 },
    { grade: "B+", min_oa: 65 },
    { grade: "B", min_oa: 60 },
    { grade: "B-", min_oa: 55 },
    { grade: "C+", min_oa: 50 },
    { grade: "C", min_oa: 45 },
    { grade: "F", min_oa: 0 },
  ],
  oaWeights: { ca: 0.3, ese: 0.7 },
  honoursClassifications: [
    { key: "first", label: "First Class Honours", threshold: 3.7 },
    { key: "second_upper", label: "Second Class Honours (Upper)", threshold: 3.3 },
    { key: "second_lower", label: "Second Class Honours (Lower)", threshold: 3.0 },
    { key: "pass", label: "Pass", threshold: 2.0 },
  ],
};

const KEY_MAP: Record<string, keyof Settings> = {
  attendance_threshold: "attendanceThreshold",
  attendance_prewarning_threshold: "attendancePrewarningThreshold",
  graduation_total_credits: "graduationTotalCredits",
  total_semesters: "totalSemesters",
  first_batch_intake_year: "firstBatchIntakeYear",
  medical_submission_deadline_days: "medicalSubmissionDeadlineDays",
  feedback_text_max_length: "feedbackTextMaxLength",
  feedback_min_responses_for_analytics: "feedbackMinResponsesForAnalytics",
  student_departments: "studentDepartments",
  interdisciplinary_department: "interdisciplinaryDepartment",
  gpv_scale: "gpvScale",
  grade_boundaries: "gradeBoundaries",
  oa_weights: "oaWeights",
  honours_classifications: "honoursClassifications",
};

let cache: Settings = DEFAULT_SETTINGS;
let loadPromise: Promise<Settings> | null = null;
const subscribers = new Set<(s: Settings) => void>();

/**
 * Current settings, available synchronously. Returns the defaults until
 * loadSettings() resolves, so callers never have to handle an undefined
 * state — they just briefly see the standard faculty rules.
 */
export function getSettings(): Settings {
  return cache;
}

export function loadSettings(): Promise<Settings> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { data, error } = await supabase
      .from("system_settings")
      .select("key, value");

    if (error || !data) return cache;

    const next: Settings = { ...DEFAULT_SETTINGS };
    data.forEach((row: { key: string; value: unknown }) => {
      const field = KEY_MAP[row.key];
      if (field && row.value !== null && row.value !== undefined) {
        (next as unknown as Record<string, unknown>)[field] = row.value;
      }
    });

    cache = next;
    subscribers.forEach((fn) => fn(cache));
    return cache;
  })();

  return loadPromise;
}

export function useSettings(): Settings {
  const [settings, setSettings] = useState<Settings>(cache);

  useEffect(() => {
    subscribers.add(setSettings);
    loadSettings();
    return () => {
      subscribers.delete(setSettings);
    };
  }, []);

  return settings;
}

/** Letter grade and grade point for an overall-assessment mark. */
export function gradeForMark(
  oa: number,
  settings: Settings = cache,
): { grade: string; gpv: number } {
  const boundary =
    settings.gradeBoundaries.find((b) => oa >= b.min_oa) ??
    settings.gradeBoundaries[settings.gradeBoundaries.length - 1];
  return { grade: boundary.grade, gpv: settings.gpvScale[boundary.grade] ?? 0 };
}

/**
 * Overall assessment mark from its two components.
 *
 * Two, not three. The Faculty Handbook is explicit — "Assessment in respect of
 * each Course consists of CA and ESE" — and the mid-semester paper is one of
 * the things CA is built from, alongside practicals, assignments and quizzes.
 * It is recorded, and it reaches the overall mark through CA rather than
 * beside it.
 *
 * The weights belong to the course, because the handbook says the split "may
 * vary from Course to Course". Callers pass the course's own; the faculty
 * default is used only when a course has not been given one.
 */
export function overallMark(
  ca: number,
  ese: number,
  weights?: { ca: number; ese: number },
  settings: Settings = cache,
): number {
  const w = weights ?? settings.oaWeights;
  return Math.round((ca * w.ca + ese * w.ese) * 10) / 10;
}
