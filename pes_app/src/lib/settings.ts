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
  oaWeights: { mid_sem: number; ca: number; ese: number };
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
    "C-": 1.7,
    "D+": 1.3,
    D: 1.0,
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
    { grade: "C-", min_oa: 40 },
    { grade: "D+", min_oa: 35 },
    { grade: "D", min_oa: 30 },
    { grade: "F", min_oa: 0 },
  ],
  oaWeights: { mid_sem: 0.4, ca: 0.2, ese: 0.4 },
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

/** Overall assessment mark from its weighted components. */
export function overallMark(
  midSem: number,
  ca: number,
  ese: number,
  settings: Settings = cache,
): number {
  const w = settings.oaWeights;
  return (
    Math.round((midSem * w.mid_sem + ca * w.ca + ese * w.ese) * 10) / 10
  );
}
