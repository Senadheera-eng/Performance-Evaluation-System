import { useEffect, useMemo } from "react";
import { describeBatch } from "../../../lib/batch";

/** The minimum an offering must carry to be picked from. */
export interface PickableOffering {
  offering_id: string;
  course_code: string;
  course_title: string;
  semester: number;
  batch_year: number;
  /** Optional: when false the option is marked view-only (HOD on a course
   *  they do not teach). */
  canEdit?: boolean;
}

/**
 * Batch first, then course.
 *
 * A lecturer teaching the same course to two batches saw two lines that read
 * almost identically, and a head of department saw every offering the
 * department runs in one list. Choosing the cohort first cuts the second
 * dropdown down to the handful of courses that belong to it, and makes the
 * batch an explicit decision rather than something buried in the option text.
 *
 * The component holds no selection state of its own: the parent owns the
 * offering id, and the batch is derived from it. That keeps the two in step —
 * there is no way for the visible batch and the loaded sheet to disagree.
 */
export function OfferingPicker({
  offerings,
  value,
  onChange,
  showViewOnly = false,
  courseLabel = "Course",
}: {
  offerings: PickableOffering[];
  value: string;
  onChange: (offeringId: string) => void;
  showViewOnly?: boolean;
  courseLabel?: string;
}) {
  const batches = useMemo(
    () => [...new Set(offerings.map((o) => o.batch_year))].sort((a, b) => b - a),
    [offerings],
  );

  const selected = offerings.find((o) => o.offering_id === value) ?? null;
  const batch = selected?.batch_year ?? batches[0] ?? null;

  const coursesInBatch = useMemo(
    () =>
      offerings
        .filter((o) => o.batch_year === batch)
        .sort(
          (a, b) =>
            Number(b.canEdit ?? true) - Number(a.canEdit ?? true) ||
            a.semester - b.semester ||
            a.course_code.localeCompare(b.course_code),
        ),
    [offerings, batch],
  );

  /* Keep the selection inside the visible batch. This also picks the first
     course on first render, so the page is never left with nothing chosen. */
  useEffect(() => {
    if (coursesInBatch.length === 0) return;
    if (!coursesInBatch.some((o) => o.offering_id === value)) {
      onChange(coursesInBatch[0].offering_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coursesInBatch, value]);

  const selectBatch = (next: number) => {
    const first = offerings
      .filter((o) => o.batch_year === next)
      .sort(
        (a, b) =>
          Number(b.canEdit ?? true) - Number(a.canEdit ?? true) ||
          a.semester - b.semester ||
          a.course_code.localeCompare(b.course_code),
      )[0];
    if (first) onChange(first.offering_id);
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <label className="flex flex-col gap-1 sm:w-64">
        <span className="text-xs font-medium text-muted-foreground">Batch</span>
        <select
          value={batch ?? ""}
          onChange={(e) => selectBatch(Number(e.target.value))}
          className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
        >
          {batches.map((b) => (
            <option key={b} value={b}>
              {describeBatch(b)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          {courseLabel}
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
        >
          {coursesInBatch.map((o) => (
            <option key={o.offering_id} value={o.offering_id}>
              {o.course_code} — {o.course_title} · Sem {o.semester}
              {showViewOnly && o.canEdit === false ? "  (view only)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
