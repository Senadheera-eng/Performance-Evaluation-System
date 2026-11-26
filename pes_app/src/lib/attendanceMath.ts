/**
 * Attendance percentage/tier math, extracted unchanged from the original
 * Attendance page so every surface (summary cards, calendar, history,
 * warnings) reads from one place instead of re-deriving these numbers.
 *
 * The formulas are the original page's; the two lecture counts are now worked
 * in exact arithmetic (see below). "Excused" has always counted toward compliance the same way
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

/*
 * Both counts below are worked in whole percentage points (80, not 0.8). As
 * fractions they were off by one: 0.8 and 0.2 are not exact in binary, so
 * 7 of 10 lectures at 80% gave (8 - 7) / 0.2 = 5.000000000000001, whose
 * ceiling is 6, when 5 more lectures (12 of 15) already reach 80%. The small
 * tolerance keeps a fractional threshold, such as 82.5, just as safe.
 */
const TOLERANCE = 1e-9;

/**
 * How many more absences the student can afford and still be at or above
 * the threshold.
 */
export function getAbsencesAllowed(
  compliant: number,
  total: number,
  thresholdPct: number,
): number {
  return Math.max(0, Math.floor((100 * compliant - thresholdPct * total) / thresholdPct + TOLERANCE));
}

/**
 * Lectures the student must attend, with zero further absences, to climb
 * back to the threshold.
 */
export function getLecturesNeededToRecover(
  compliant: number,
  total: number,
  thresholdPct: number,
): number {
  return Math.max(0, Math.ceil((thresholdPct * total - 100 * compliant) / (100 - thresholdPct) - TOLERANCE));
}

export const TIER_LABEL: Record<AttendanceTier, string> = {
  excellent: "Excellent",
  safe: "Safe",
  at_risk: "At Risk",
  critical: "Critical",
  pending: "No Records Yet",
};
