import { supabase } from "./supabase";

/**
 * Sign-ins worth a second look, from the attendance anomaly model
 * (ml/attendance_anomaly.py).
 *
 * The database scores every live sign-in to a lecture with an Isolation
 * Forest trained on how ordinary sign-ins look, and lists the unusual ones
 * with the reasons, in the lecturer's words. A sign-in a kilometre or more
 * from the lecture is always listed. Only the staff who may read a course's
 * register may ask. A flag is a reason to look, never a mark: nothing here
 * changes attendance.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface FlaggedCheckin {
  student_id: string;
  name: string;
  index_number: string | null;
  checked_in_at: string;
  session_status: "open" | "closed";
  score: number;
  /** What was unusual, as sentences; empty if only the combination was. */
  reasons: string[];
}

/** One approach's scores on the simulated test lectures. */
export interface ReviewEvaluationRow {
  model: string;
  recall: number;
  precision: number;
  false_alarms_per_lecture: number;
  by_type: Record<string, number>;
}

export interface CheckinReview {
  model: {
    name: string;
    algorithm: string;
    trained_at: string;
    evaluation: {
      test?: { lectures: number; proxies: number; results: ReviewEvaluationRow[] };
    };
  };
  /** Sign-ins to this course on this date. */
  signed_in: number;
  /** The unusual ones, most unusual first. */
  flagged: FlaggedCheckin[];
}

/** Null when no model is loaded. */
export async function getCheckinReview(
  offeringId: string,
  lectureDate: string,
): Promise<Result<CheckinReview | null>> {
  const { data, error } = await supabase.rpc("get_checkin_review", {
    p_offering_id: offeringId,
    p_lecture_date: lectureDate,
  });
  if (error) {
    console.error("[checkinReview] get_checkin_review", error);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: (data ?? null) as CheckinReview | null };
}

/** The deployed approach and today's location rules, from the evaluation. */
export function reviewCheck(review: CheckinReview) {
  const results = review.model.evaluation.test?.results ?? [];
  return {
    model: results.find((r) => r.model.startsWith("Isolation Forest +")) ?? results[results.length - 1],
    rules: results.find((r) => r.model.startsWith("Rules today")),
    lectures: review.model.evaluation.test?.lectures,
    proxies: review.model.evaluation.test?.proxies,
  };
}
