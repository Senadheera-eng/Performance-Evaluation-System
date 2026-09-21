import { useEffect, useMemo, useState } from "react";
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
  /** Optional: the batch is in this course's semester now. Such courses
   *  are offered first, so the picker opens on what is being taught. */
  is_current?: boolean;
  /** Optional: named in the course option only when the list spans more
   *  than one department, which it does for a super admin. */
  department?: string;
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

  /* One department's list needs no department labels; the faculty's does,
     because two departments run their own Semester 1 courses side by side. */
  const spansDepartments = useMemo(
    () => new Set(offerings.map((o) => o.department).filter(Boolean)).size > 1,
    [offerings],
  );

  /* A filter, not a selection, so it lives here rather than being lifted:
     the parent owns which offering is chosen and does not need to know how
     the person narrowed the list to find it. */
  const [semesterFilter, setSemesterFilter] = useState<number | "all">("all");

  const semestersInBatch = useMemo(
    () =>
      [...new Set(offerings.filter((o) => o.batch_year === batch).map((o) => o.semester))]
        .sort((a, b) => a - b),
    [offerings, batch],
  );

  /* The semester the batch is sitting now, if any of its offerings is this
     semester's. */
  const currentSemester = useMemo(() => {
    const current = offerings.find((o) => o.batch_year === batch && o.is_current);
    return current?.semester ?? null;
  }, [offerings, batch]);

  /* Opens on what the batch is doing now. Batch 7 is in Semester 7, so a
     lecturer marking a register should not have to pick their way past the
     Semester 5 and 6 classes that batch finished two years ago — but those
     are still one choice away, for a repeat student or a late correction.
     A batch also holds a different set of semesters, so carrying the old
     filter across would show an empty course list for a batch with plenty. */
  useEffect(() => {
    setSemesterFilter(currentSemester ?? "all");
  }, [batch, currentSemester]);

  const coursesInBatch = useMemo(
    () =>
      offerings
        .filter(
          (o) =>
            o.batch_year === batch &&
            (semesterFilter === "all" || o.semester === semesterFilter),
        )
        .sort(
          (a, b) =>
            Number(b.canEdit ?? true) - Number(a.canEdit ?? true) ||
            Number(b.is_current ?? false) - Number(a.is_current ?? false) ||
            a.semester - b.semester ||
            a.course_code.localeCompare(b.course_code),
        ),
    [offerings, batch, semesterFilter],
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
          Number(b.is_current ?? false) - Number(a.is_current ?? false) ||
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

      {/* Only worth showing when the batch actually spans more than one
          semester — a lecturer with three courses in one semester does not
          need a control that can only ever do nothing. */}
      {semestersInBatch.length > 1 && (
        <label className="flex flex-col gap-1 sm:w-44">
          <span className="text-xs font-medium text-muted-foreground">
            Semester
          </span>
          <select
            value={semesterFilter}
            onChange={(e) =>
              setSemesterFilter(
                e.target.value === "all" ? "all" : Number(e.target.value),
              )
            }
            className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="all">All semesters</option>
            {semestersInBatch.map((s) => (
              <option key={s} value={s}>
                Semester {s}
                {s === currentSemester ? " (Current)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

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
              {spansDepartments && o.department ? ` · ${o.department}` : ""}
              {showViewOnly && o.canEdit === false ? "  (view only)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
