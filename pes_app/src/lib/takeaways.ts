/**
 * One-sentence readings of a chart, for the line under it. Each is worked out
 * from the very numbers the chart draws, so the sentence and the picture can
 * never disagree. Presentation only: nothing here is a calculation the rest
 * of the system relies on.
 */

/** "Your SGPA fell from 3.81 to 3.57 in Sem 6. Your best so far is 3.81 (Sem 5)." */
export function gpaTrendTakeaway(points: { semester: string; gpa: number }[]): string | undefined {
  if (points.length === 0) return undefined;
  const last = points[points.length - 1];
  if (points.length === 1) return `Your first SGPA is ${last.gpa.toFixed(2)}.`;
  const prev = points[points.length - 2];
  const diff = last.gpa - prev.gpa;
  const best = points.reduce((a, b) => (b.gpa > a.gpa ? b : a));
  const move =
    Math.abs(diff) < 0.05
      ? `Your SGPA held steady at ${last.gpa.toFixed(2)} in ${last.semester}`
      : `Your SGPA ${diff > 0 ? "rose" : "fell"} from ${prev.gpa.toFixed(2)} to ${last.gpa.toFixed(2)} in ${last.semester}`;
  return `${move}. Your best so far is ${best.gpa.toFixed(2)} (${best.semester}).`;
}

/** "Your most common grade is A: 18 of 49 graded courses." */
export function gradeSpreadTakeaway(spread: { grade: string; count: number }[]): string | undefined {
  const total = spread.reduce((n, g) => n + g.count, 0);
  if (total === 0) return undefined;
  const top = spread.reduce((a, b) => (b.count > a.count ? b : a));
  return `Your most common grade is ${top.grade}: ${top.count} of ${total} graded course${total === 1 ? "" : "s"}.`;
}
