import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ErrorState, StatusBadge } from "../common";
import { supabase } from "../../../lib/supabase";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";

export interface PeriodCourseStat {
  course_id: string;
  course_code: string;
  course_title: string;
  capacity: number | null;
  eligible_count: number;
  enrolled_count: number;
}

interface EnrolledStudent {
  student_id: string;
  name: string;
  index_number: string;
  reg_number: string;
  batch_year: number;
  department: string;
  status: string;
  enrolled_at: string | null;
}

/**
 * What a window actually contains: its courses, and under each one the
 * students who enrolled.
 *
 * Read-only by nature, so the same component serves the super admin who opened
 * the window and the head of department who may only watch it. The two RPCs
 * behind it scope their own answers — a head sees their department's courses
 * and their department's students, and nothing else — so there is no
 * caller-supplied filter here that a different caller could get wrong.
 *
 * The component owns its own loading: the parent renders it when a period is
 * expanded and unmounts it when the period closes, which is why there is no
 * period-keyed cache to keep in step with what is on screen.
 */
export function PeriodCourseBreakdown({
  periodId,
  batchYear,
}: {
  periodId: string;
  /** The batch the window is aimed at; null for a repeat-only window, where
   *  each student sits with a different one. */
  batchYear: number | null;
}) {
  const [courses, setCourses] = useState<PeriodCourseStat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [rosters, setRosters] = useState<Record<string, EnrolledStudent[]>>({});
  const [rosterLoading, setRosterLoading] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<Record<string, string>>({});

  const loadCourses = async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      "get_enrollment_period_course_stats",
      { p_period_id: periodId },
    );
    if (rpcError) {
      console.error("[PeriodCourseBreakdown] course stats failed", rpcError);
      setError("Unable to load courses for this period.");
    } else {
      setCourses((data ?? []) as PeriodCourseStat[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);

  const toggleCourse = async (courseId: string) => {
    if (openCourseId === courseId) {
      setOpenCourseId(null);
      return;
    }
    setOpenCourseId(courseId);
    if (rosters[courseId]) return;

    setRosterLoading(courseId);
    setRosterError((prev) => {
      const next = { ...prev };
      delete next[courseId];
      return next;
    });
    const { data, error: rpcError } = await supabase.rpc(
      "get_course_enrolled_students",
      { p_course_id: courseId, p_batch_year: batchYear },
    );
    if (rpcError) {
      console.error("[PeriodCourseBreakdown] roster failed", rpcError);
      setRosterError((prev) => ({
        ...prev,
        [courseId]: "Unable to load enrolled students.",
      }));
    } else {
      setRosters((prev) => ({
        ...prev,
        [courseId]: (data ?? []) as EnrolledStudent[],
      }));
    }
    setRosterLoading(null);
  };

  if (loading) return <div className="h-16 rounded-lg bg-muted animate-pulse" />;
  if (error)
    return <ErrorState message={error} onRetry={loadCourses} size="inline" />;
  if ((courses?.length ?? 0) === 0)
    return (
      <p className="text-xs text-muted-foreground py-2">
        No courses match this period's semester.
      </p>
    );

  return (
    <div className="space-y-1.5">
      {courses!.map((c) => {
        const open = openCourseId === c.course_id;
        const remaining =
          c.capacity !== null ? Math.max(0, c.capacity - c.enrolled_count) : null;
        return (
          <div
            key={c.course_id}
            className="rounded-lg border border-border/70 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleCourse(c.course_id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors bg-card"
            >
              <div className="flex items-center gap-2 min-w-0">
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-sm font-semibold text-primary flex-shrink-0">
                  {c.course_code}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {c.course_title}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-xs">
                <span className="text-foreground tabular-nums">
                  {c.enrolled_count} of {c.eligible_count} enrolled
                </span>
                {remaining !== null && (
                  <StatusBadge tone={remaining === 0 ? "danger" : "neutral"}>
                    {remaining} seat{remaining === 1 ? "" : "s"} left
                  </StatusBadge>
                )}
              </div>
            </button>

            {open && (
              <div className="px-3 py-2 border-t border-border/70 bg-muted/20">
                {rosterLoading === c.course_id ? (
                  <div className="h-12 rounded-lg bg-muted animate-pulse" />
                ) : rosterError[c.course_id] ? (
                  <ErrorState
                    message={rosterError[c.course_id]}
                    onRetry={() => toggleCourse(c.course_id)}
                    size="inline"
                  />
                ) : (rosters[c.course_id]?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">
                    No students enrolled in this course yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground text-left border-b border-border/70">
                          <th className="pb-1.5 pr-3 font-medium">Student</th>
                          <th className="pb-1.5 pr-3 font-medium">Index No.</th>
                          <th className="pb-1.5 pr-3 font-medium">Reg. No.</th>
                          <th className="pb-1.5 pr-3 font-medium">Batch</th>
                          <th className="pb-1.5 pr-3 font-medium">Department</th>
                          <th className="pb-1.5 pr-3 font-medium">Status</th>
                          <th className="pb-1.5 font-medium">Enrolled</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {rosters[c.course_id].map((s) => (
                          <tr key={s.student_id}>
                            <td className="py-1.5 pr-3 text-foreground">
                              {s.name}
                            </td>
                            <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                              {s.index_number}
                            </td>
                            <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                              {formatRegNumber(s.reg_number)}
                            </td>
                            <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                              {describeBatch(s.batch_year)}
                            </td>
                            <td className="py-1.5 pr-3 text-muted-foreground">
                              {s.department}
                            </td>
                            <td className="py-1.5 pr-3">
                              <StatusBadge tone="success">{s.status}</StatusBadge>
                            </td>
                            <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                              {s.enrolled_at
                                ? new Date(s.enrolled_at).toLocaleDateString(
                                    "en-US",
                                    {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                    },
                                  )
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
