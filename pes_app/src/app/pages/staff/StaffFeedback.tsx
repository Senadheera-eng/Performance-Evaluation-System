import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  MessageSquareText,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  StatCard,
  StatusBadge,
  type StatusTone,
} from "../../components/common";
import { FeedbackRequests } from "../../components/staff/FeedbackRequests";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import {
  getMyFeedbackDetail,
  getMyFeedbackOverview,
  type FeedbackDetail,
  type FeedbackOverviewRow,
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

const TABS = [
  { value: "results", label: "Results" },
  { value: "forms", label: "My Forms" },
];

/**
 * A lecturer's own feedback: what came back, and what they asked for.
 *
 * Response progress is always visible — knowing how many people replied
 * identifies nobody, and it is what tells a lecturer whether to chase their
 * class. Results are not: they appear only once the department has released
 * them, and only when there are enough responses that a single reply cannot
 * be picked out. Both rules are enforced in the database; this page only
 * reflects them.
 */
export default function StaffFeedback() {
  const { staff } = useAuth();
  const [tab, setTab] = useState("results");
  const [rows, setRows] = useState<FeedbackOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, FeedbackDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  useEffect(() => {
    if (staff) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await getMyFeedbackOverview();
    if (!result.ok) {
      setError("We could not load your feedback. Please try again.");
      setLoading(false);
      return;
    }
    setRows(result.data);
    setLoading(false);
  };

  const rowKey = (r: FeedbackOverviewRow) => `${r.period_id}:${r.offering_id}`;

  const toggle = async (r: FeedbackOverviewRow) => {
    const key = rowKey(r);
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    if (details[key]) return;

    setDetailLoading(key);
    const result = await getMyFeedbackDetail(r.period_id, r.offering_id);
    if (result.ok) {
      setDetails((prev) => ({ ...prev, [key]: result.data }));
    } else {
      setDetails((prev) => ({
        ...prev,
        [key]: { released: false, message: result.error },
      }));
    }
    setDetailLoading(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feedback"
        description="What your students said about the courses you teach, and the forms you have asked your department to run."
      />

      <SegmentedTabs
        tabs={TABS}
        value={tab}
        onChange={setTab}
        layoutId="staff-feedback-tabs"
        aria-label="Feedback view"
      />

      {tab === "forms" ? (
        <FeedbackRequests />
      ) : (
        <ResultsTab
          rows={rows}
          loading={loading}
          error={error}
          onRetry={load}
          expanded={expanded}
          details={details}
          detailLoading={detailLoading}
          onToggle={toggle}
        />
      )}
    </div>
  );
}

function ResultsTab({
  rows,
  loading,
  error,
  onRetry,
  expanded,
  details,
  detailLoading,
  onToggle,
}: {
  rows: FeedbackOverviewRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  expanded: string | null;
  details: Record<string, FeedbackDetail>;
  detailLoading: string | null;
  onToggle: (row: FeedbackOverviewRow) => void;
}) {
  const rowKey = (r: FeedbackOverviewRow) => `${r.period_id}:${r.offering_id}`;
  const released = rows.filter((r) => r.is_released);
  const awaiting = rows.filter((r) => !r.is_released);
  const overallAvg = useMemo(() => {
    const rated = released.filter((r) => r.avg_rating !== null);
    if (rated.length === 0) return null;
    return (
      rated.reduce((sum, r) => sum + (r.avg_rating ?? 0), 0) / rated.length
    );
  }, [released]);
  const totalResponses = rows.reduce((sum, r) => sum + r.response_count, 0);

  return (
    <div className="space-y-5">
      {error && <ErrorState message={error} onRetry={onRetry} />}

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
          label="Total Responses"
          value={totalResponses}
          icon={Users}
          tone="info"
        />
        <StatCard
          index={2}
          label="Average Rating"
          value={overallAvg !== null ? overallAvg.toFixed(2) : "—"}
          icon={Star}
          tone={ratingTone(overallAvg)}
          hint="Across released results"
        />
        <StatCard
          index={3}
          label="Awaiting Release"
          value={awaiting.length}
          icon={Lock}
          tone={awaiting.length > 0 ? "warning" : "neutral"}
        />
      </div>

      <SectionCard
        title="Course by course"
        description="Select a course to see its questions and comments."
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
              title="No feedback yet"
              description="Once a feedback period covers a course you teach, its response progress appears here."
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
                    onClick={() => onToggle(r)}
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
                          <span className="text-sm font-semibold text-primary">
                            {r.course_code}
                          </span>
                          <span className="truncate text-sm text-foreground">
                            {r.course_title}
                          </span>
                          <StatusBadge tone="neutral">
                            {r.feedback_type === "mid_semester"
                              ? "Mid semester"
                              : "End semester"}
                          </StatusBadge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.period_title} · {describeBatch(r.batch_year)} ·
                          Semester {r.semester}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.response_count} of {r.eligible_count} responded (
                          {r.response_rate}%)
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-3">
                      {r.avg_rating !== null && (
                        <div className="text-right">
                          <p className="text-sm font-semibold tabular-nums text-foreground">
                            {r.avg_rating.toFixed(2)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            avg
                          </p>
                        </div>
                      )}
                      {r.is_released ? (
                        <StatusBadge tone="success" icon={ShieldCheck}>
                          Released
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral" icon={Lock}>
                          Not released
                        </StatusBadge>
                      )}
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-border/70 bg-muted/20 px-4 py-3">
                      {detailLoading === key ? (
                        <SkeletonRows count={3} height="h-8" />
                      ) : !detail ? null : !detail.released ||
                        detail.below_threshold ? (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>{detail.message}</span>
                        </div>
                      ) : (
                        <FeedbackDetailView detail={detail} />
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

function FeedbackDetailView({ detail }: { detail: FeedbackDetail }) {
  const questions = detail.questions ?? [];
  const comments = detail.comments ?? [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {detail.response_count} response
        {detail.response_count === 1 ? "" : "s"}.
      </p>

      {questions.length > 0 && (
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
                  <td className="py-1.5 pr-3 text-foreground">
                    {q.question_text}
                    {q.target_type === "lecturer" && (
                      <StatusBadge tone="brand" className="ml-1.5">
                        About you
                      </StatusBadge>
                    )}
                  </td>
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
      )}

      {comments.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground">
            Comments
          </p>
          {/* No identity is attached here, whatever the student chose about
              anonymity — that choice concerns the department, not the person
              being rated. */}
          <ul className="space-y-2">
            {comments.map((c, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/70 bg-card px-3 py-2"
              >
                <p className="text-[11px] text-muted-foreground">
                  {c.question_text}
                </p>
                <p className="mt-0.5 text-sm text-foreground">{c.comment}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {questions.length === 0 && comments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No answers were recorded for this course.
        </p>
      )}
    </div>
  );
}
