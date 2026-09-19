import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ErrorState, SkeletonRows, StatusBadge } from "../common";
import { supabase } from "../../../lib/supabase";

interface CourseDetail {
  id: string;
  course_code: string;
  title: string;
  credits: number;
  semester: number;
  year: number;
  department: string;
  category: string;
  minor_category: string | null;
  contributes_to_gpa: boolean;
  ca_weight: number;
  ese_weight: number;
  coordinators: string[];
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 last:border-0">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-right text-sm font-medium text-foreground">
      {value}
    </span>
  </div>
);

const pct = (f: number) => `${Math.round(f * 100)}%`;

/**
 * What a course is, for the student taking it.
 *
 * The part worth having is the assessment split. A student who knows the end
 * examination carries sixty per cent of the mark is being told something they
 * cannot work out from a grade after the fact, and it is the department's own
 * figure rather than a faculty-wide assumption.
 */
export function CourseDetailDialog({
  courseId,
  onOpenChange,
}: {
  /** Null closes the dialog. */
  courseId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    (async () => {
      const { data, error: rpcError } = await supabase.rpc(
        "get_course_detail",
        { p_course_id: courseId },
      );
      if (cancelled) return;
      if (rpcError) {
        setError("We could not load this course.");
        setLoading(false);
        return;
      }
      setDetail(data as CourseDetail);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  return (
    <Dialog open={courseId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {detail ? `${detail.course_code} — ${detail.title}` : "Course"}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? `${detail.department} · Semester ${detail.semester} · Year ${detail.year}`
              : "Loading course details…"}
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorState message={error} size="inline" />}
        {loading && <SkeletonRows count={6} height="h-8" />}

        {detail && (
          <>
            <div>
              <Row label="Course code" value={detail.course_code} />
              <Row label="Course name" value={detail.title} />
              <Row
                label="Course coordinator"
                value={
                  detail.coordinators.length > 0
                    ? detail.coordinators.join(", ")
                    : "Not assigned yet"
                }
              />
              <Row label="Credits" value={detail.credits} />
              <Row label="Semester" value={`Semester ${detail.semester}`} />
              <Row
                label="Category"
                value={
                  detail.minor_category
                    ? `${detail.category} · ${detail.minor_category}`
                    : detail.category
                }
              />
              <Row
                label="Counts toward GPA"
                value={
                  detail.contributes_to_gpa ? (
                    <StatusBadge tone="success">Yes</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">No</StatusBadge>
                  )
                }
              />
            </div>

            <div className="rounded-xl border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                How your final mark is made up
              </p>
              <div className="mt-2 space-y-1.5">
                {(
                  [
                    ["Continuous assessment (CA)", detail.ca_weight],
                    ["End-of-semester examination (ESE)", detail.ese_weight],
                  ] as const
                )
                  .filter(([, w]) => w > 0)
                  .map(([label, w]) => (
                    <div key={label}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-semibold text-foreground tabular-nums">
                          {pct(w)}
                        </span>
                      </div>
                      <div
                        className="mt-1 h-1.5 rounded-full bg-muted"
                        role="presentation"
                      >
                        <div
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width: pct(w) }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Your overall mark (OA) is these two added together, and your
                grade comes from that. CA covers your mid-semester paper,
                practicals, assignments and quizzes.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
