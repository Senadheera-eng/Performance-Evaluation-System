/**
 * Attendance percentage/tier math, extracted unchanged from the original
 * Attendance page so every surface (summary cards, calendar, history,
 * warnings) reads from one place instead of re-deriving these numbers.
 *
 * The underlying formulas are untouched — only the presentation around them
 * changed. "Excused" has always counted toward compliance the same way
 * "present" does, matching how attendance is recorded on the admin side.
 */

/** Points above the threshold that count as "excellent" rather than "safe". */
export const EXCELLENT_MARGIN = 10;

export type AttendanceTier = "excellent" | "safe" | "at_risk" | "critical" | "pending";

export interface AttendanceCounts {
  present: number;
  absent: number;
  excused: number;
}

export function compliantCount(counts: AttendanceCounts): number {
  return counts.present + counts.excused;
}

export function totalCount(counts: AttendanceCounts): number {
  return counts.present + counts.absent + counts.excused;
}

export function percentageOf(counts: AttendanceCounts): number {
  const total = totalCount(counts);
  return total > 0 ? Math.round((compliantCount(counts) / total) * 100) : 0;
}

/**
 * Five-tier classification. The three inner boundaries reuse configurable
 * settings (attendanceThreshold, attendancePrewarningThreshold) rather than
 * a new hard-coded number for "at risk" — clamped so a misconfigured
 * pre-warning value can't produce a non-monotonic tier order.
 */
export function classifyTier(
  percentage: number,
  total: number,
  thresholdPct: number,
  prewarningPct: number,
): AttendanceTier {
  if (total === 0) return "pending";
  const preWarn = Math.max(
    thresholdPct,
    Math.min(prewarningPct, thresholdPct + EXCELLENT_MARGIN),
  );
  if (percentage < thresholdPct) return "critical";
  if (percentage < preWarn) return "at_risk";
  if (percentage < thresholdPct + EXCELLENT_MARGIN) return "safe";
  return "excellent";
}

/**
 * How many more absences the student can afford before dropping below the
 * threshold — identical formula to the original implementation.
 */
export function getAbsencesAllowed(
  compliant: number,
  total: number,
  thresholdPct: number,
): number {
  const t = thresholdPct / 100;
  return Math.max(0, Math.floor((compliant - t * total) / t));
}

/**
 * Lectures the student must attend, with zero further absences, to climb
 * back above the threshold — identical formula to the original
 * implementation (previously only computed inline for the critical alert).
 */
export function getLecturesNeededToRecover(
  compliant: number,
  total: number,
  thresholdPct: number,
): number {
  const t = thresholdPct / 100;
  return Math.max(0, Math.ceil((t * total - compliant) / (1 - t)));
}

export const TIER_LABEL: Record<AttendanceTier, string> = {
  excellent: "Excellent",
  safe: "Safe",
  at_risk: "At Risk",
  critical: "Critical",
  pending: "No Records Yet",
};
