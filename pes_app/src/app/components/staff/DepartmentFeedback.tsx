import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  MessageSquareText,
  Star,
  UserSquare,
  Users,
} from "lucide-react";
import {
  CourseCode,
  EmptyState,
  ErrorState,
  SectionCard,
  SkeletonRows,
  StatCard,
  StatusBadge,
  type StatusTone,
} from "../common";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import {
  getDepartmentFeedbackDetail,
  getDepartmentFeedbackOverview,
  getDepartmentLecturerFeedback,
  type DepartmentFeedbackDetail,
  type DepartmentFeedbackRow,
  type DepartmentLecturerRow,
  type DepartmentQuestionResult,
} from "../../../lib/staffService";

const RATING_LABELS: Record<string, string> = {
  "1": "Strongly Disagree",
  "2": "Disagree",
  "3": "Neutral",
  "4": "Agree",
  "5": "Strongly Agree",
};

const ratingTone = (avg: number | null): StatusTone => {
  if (avg === null) return "neutral";
  if (avg >= 4) return "success";
  if (avg >= 3) return "info";
  if (avg >= 2) return "warning";
  return "danger";
};

/**
 * Feedback across the whole department, for its head.
 *
 * A lecturer sees their own courses once the department releases them. A head
 * of department is accountable for the department's teaching, so the scope
 * here is every course it owns and the gate is the period having closed
 * rather than a release — releasing is the separate act of forwarding results
 * to the person being rated.
 *
 * What does not change is the minimum-response threshold: a course with only
 * a handful of replies shows its response count and nothing else, because
 * below that a single student can be identified from what they wrote. That is
 * owed to the student whoever is reading, and the database withholds it
 * regardless of what this page asks for.
 */
export function DepartmentFeedback() {
  const { staff } = useAuth();
  const [rows, setRows] = useState<DepartmentFeedbackRow[]>([]);
  const [lecturers, setLecturers] = useState<DepartmentLecturerRow[]>([]);
  const [periodId, setPeriodId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DepartmentFeedbackDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId, periodId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const filter = periodId || null;
    const [overview, byLecturer] = await Promise.all([
      getDepartmentFeedbackOverview(filter),
      getDepartmentLecturerFeedback(filter),
    ]);

    if (!overview.ok) {
      setError("We could not load your department's feedback. Please try again.");
      setLoading(false);
      return;
    }
    setRows(overview.data);
    if (byLecturer.ok) setLecturers(byLecturer.data);
    // A period filter changes what a row means, so cached detail is stale.
    setDetails({});
    setExpanded(null);
    setLoading(false);
  };

  /* Periods are derived from the rows rather than fetched separately: the
     only periods worth filtering by are the ones that reached a course. */
  const periods = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.period_id, r.period_title);
    return [...map.entries()];
  }, [rows]);

  const rowKey = (r: DepartmentFeedbackRow) => `${r.period_id}:${r.offering_id}`;

  const toggle = async (r: DepartmentFeedbackRow) => {
    const key = rowKey(r);
    if (expanded === key) return setExpanded(null);
    setExpanded(key);
    if (details[key]) return;

    setDetailLoading(key);
    const result = await getDepartmentFeedbackDetail(r.period_id, r.offering_id);
    setDetails((prev) => ({
      ...prev,
      [key]: result.ok ? result.data : { visible: false, message: result.error },
    }));
    setDetailLoading(null);
  };

  const totals = useMemo(() => {
    const responses = rows.reduce((sum, r) => sum + r.response_count, 0);
    const eligible = rows.reduce((sum, r) => sum + r.eligible_count, 0);
    const rated = rows.filter((r) => r.avg_rating !== null);
    return {
      responses,
      rate: eligible > 0 ? Math.round((responses / eligible) * 1000) / 10 : 0,
      average:
        rated.length > 0
          ? rated.reduce((sum, r) => sum + (r.avg_rating ?? 0), 0) / rated.length
          : null,
    };
  }, [rows]);

  return (
    <div className="space-y-5">
      {error && <ErrorState message={error} onRetry={load} />}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="period-filter">
          Feedback period
        </label>
        <select
          id="period-filter"
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground sm:min-w-72"
        >
          <option value="">All periods</option>
          {periods.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          index={0}
          label="Courses With Feedback"
          value={rows.length}
          icon={MessageSquareText}
          tone="brand"
        />
        <StatCard
          index={1}
          label="Responses"
          value={totals.responses}
          icon={Users}
          tone="info"
        />
        <StatCard
          index={2}
          label="Response Rate"
          value={`${totals.rate}%`}
          icon={Users}
          tone={totals.rate >= 50 ? "success" : "warning"}
          hint="Across the department"
        />
        <StatCard
          index={3}
          label="Department Average"
          value={totals.average !== null ? totals.average.toFixed(2) : "—"}
          icon={Star}
          tone={ratingTone(totals.average)}
          hint="Closed periods only"
        />
      </div>

      <SectionCard
        title="By lecturer"
        description="Only the questions asked about each lecturer, so a shared course gives each of them their own reading."
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={4} height="h-10" />
          </div>
        ) : lecturers.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={UserSquare}
              title="Nothing to compare yet"
              description="Once a feedback period covering your department's courses closes, each lecturer appears here."
              size="inline"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Lecturer</th>
                  <th className="px-4 py-2 font-medium">Courses</th>
                  <th className="px-4 py-2 font-medium">Responses</th>
                  <th className="px-4 py-2 font-medium">Rated answers</th>
                  <th className="px-4 py-2 font-medium">Average</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {lecturers.map((l) => (
                  <tr key={l.lecturer_id}>
                    <td className="px-4 py-2 text-foreground">
                      {l.lecturer_name}
                      {l.is_hod && (
                        <StatusBadge tone="brand" className="ml-1.5">
                          You
                        </StatusBadge>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {l.course_count}
                      {l.courses_withheld > 0 && (
                        <span className="ml-1.5 text-xs">
                          ({l.courses_withheld} withheld)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {l.response_count}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {l.rated_answers}
                    </td>
                    <td className="px-4 py-2">
                      {l.avg_rating !== null ? (
                        <StatusBadge tone={ratingTone(l.avg_rating)}>
                          {l.avg_rating.toFixed(2)}
                        </StatusBadge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not enough responses
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="By course"
        description="Select a course to see its questions, each lecturer's ratings and the written comments."
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={4} height="h-16" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={MessageSquareText}
              title="No feedback in your department yet"
              description="Courses appear here once a feedback period covers them."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {rows.map((r) => {
              const key = rowKey(r);
              const open = expanded === key;
              const detail = details[key];
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => toggle(r)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {open ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <CourseCode code={r.course_code} className="text-sm" />
                          <span className="truncate text-sm text-foreground">
                            {r.course_title}
                          </span>
                          <StatusBadge tone="neutral">
                            {r.feedback_type === "mid_semester"
                              ? "Mid semester"
                              : "End semester"}
                          </StatusBadge>
                          {/* Lecturers read their own results as soon as the
                              round opens, so what is worth saying here is
                              whether it is still collecting. */}
                          {r.period_status === "open" && (
                            <StatusBadge tone="success" dot>
                              Collecting
                            </StatusBadge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.period_title} · {describeBatch(r.batch_year)} · Semester{" "}
                          {r.semester}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.lecturers ?? "No lecturer assigned"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.response_count} of {r.eligible_count} responded (
                          {r.response_rate}%)
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-3">
                      {r.avg_rating !== null ? (
                        <div className="text-right">
                          <p className="text-sm font-semibold tabular-nums text-foreground">
                            {r.avg_rating.toFixed(2)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">avg</p>
                        </div>
                      ) : (
                        <StatusBadge tone="neutral" icon={Lock}>
                          {r.below_threshold ? "Too few responses" : "Not closed yet"}
                        </StatusBadge>
                      )}
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-border/70 bg-muted/20 px-4 py-3">
                      {detailLoading === key ? (
                        <SkeletonRows count={3} height="h-8" />
                      ) : !detail ? null : !detail.visible ? (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>{detail.message}</span>
                        </div>
                      ) : (
                        <DepartmentDetailView detail={detail} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function QuestionTable({ questions }: { questions: DepartmentQuestionResult[] }) {
  if (questions.length === 0) {
    return <p className="text-xs text-muted-foreground">No rated questions.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/70 text-left text-muted-foreground">
            <th className="pb-1.5 pr-3 font-medium">Question</th>
            <th className="pb-1.5 pr-3 font-medium">Responses</th>
            <th className="pb-1.5 pr-3 font-medium">Average</th>
            <th className="pb-1.5 font-medium">Spread</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {questions.map((q) => (
            <tr key={q.question_id}>
              <td className="py-1.5 pr-3 text-foreground">{q.question_text}</td>
              <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">
                {q.responses}
              </td>
              <td className="py-1.5 pr-3">
                {q.average !== null ? (
                  <StatusBadge tone={ratingTone(q.average)}>
                    {q.average.toFixed(2)}
                  </StatusBadge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-1.5 text-muted-foreground">
                {Object.entries(q.distribution)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([val, n]) => `${RATING_LABELS[val] ?? val}: ${n}`)
                  .join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DepartmentDetailView({ detail }: { detail: DepartmentFeedbackDetail }) {
  const courseQuestions = detail.course_questions ?? [];
  const lecturerBlocks = detail.lecturer_questions ?? [];
  const comments = detail.comments ?? [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {detail.response_count} response{detail.response_count === 1 ? "" : "s"}.
      </p>

      {courseQuestions.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground">
            About the course
          </p>
          <QuestionTable questions={courseQuestions} />
        </div>
      )}

      {lecturerBlocks.map((block) => (
        <div key={block.lecturer_id}>
          <p className="mb-1.5 text-xs font-semibold text-foreground">
            About {block.lecturer_name}
          </p>
          <QuestionTable questions={block.questions} />
        </div>
      ))}

      {comments.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground">Comments</p>
          {/* No identity is attached, whatever the student chose about
              anonymity — that choice concerns the department admin's records,
              not the reading of what was said about the teaching. */}
          <ul className="space-y-2">
            {comments.map((c, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/70 bg-card px-3 py-2"
              >
                <p className="text-[11px] text-muted-foreground">
                  {c.question_text}
                  {c.about_lecturer && ` — about ${c.about_lecturer}`}
                </p>
                <p className="mt-0.5 text-sm text-foreground">{c.comment}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {courseQuestions.length === 0 &&
        lecturerBlocks.length === 0 &&
        comments.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No answers were recorded for this course.
          </p>
        )}
    </div>
  );
}
