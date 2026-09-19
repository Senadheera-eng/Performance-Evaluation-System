import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Lock,
  MessageSquareText,
  RefreshCw,
  Star,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  StatCard,
  StatusBadge,
} from "../../components/common";
import { CoordinatorQuestions } from "../../components/staff/CoordinatorQuestions";
import { DepartmentFeedback } from "../../components/staff/DepartmentFeedback";
import { FeedbackReport, ratingTone } from "../../components/staff/FeedbackReport";
import { FeedbackRequests } from "../../components/staff/FeedbackRequests";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { getStaffCapabilities } from "../../../lib/staffScope";
import {
  buildFeedbackReportPdf,
  feedbackReportFilename,
} from "../../../lib/feedbackReportPdf";
import {
  getCourseFeedbackReport,
  getMyFeedbackOverview,
  type CourseFeedbackReport,
  type FeedbackOverviewRow,
} from "../../../lib/staffService";

/** How often an open round's report re-reads itself, in milliseconds. */
const LIVE_INTERVAL = 30_000;

/**
 * A lecturer's own feedback: what came back, and what they asked for.
 *
 * Response progress is always visible — knowing how many people replied
 * identifies nobody, and it is what tells a lecturer whether to chase their
 * class. What students actually said waits for two things: the round to be
 * open, and enough people to have answered that no single reply can be picked
 * out of the report. Both rules live in the database; this page only reflects
 * them.
 *
 * There is no third gate. Results used to wait on a department admin working
 * through a release list course by course, which delayed feedback without
 * deciding anything. Opening the round is the decision.
 */
export default function StaffFeedback() {
  const { staff } = useAuth();
  const caps = getStaffCapabilities(staff);
  const [tab, setTab] = useState("results");
  const [rows, setRows] = useState<FeedbackOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (staff) load();
  }, [staff?.lecturerId, load]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feedback"
        description="What your students said about the courses you teach, and the forms you have asked your department to run."
      />

      <SegmentedTabs
        tabs={[
          { value: "results", label: "Results" },
          { value: "forms", label: "My Forms" },
          // The department view belongs to the appointment, not the role, so
          // it appears and disappears with the headship. The RPCs behind it
          // refuse anyone who is not the sitting head regardless.
          ...(caps.isHod ? [{ value: "department", label: "Department" }] : []),
        ]}
        value={tab}
        onChange={setTab}
        layoutId="staff-feedback-tabs"
        aria-label="Feedback view"
      />

      {tab === "forms" ? (
        <div className="space-y-5">
          {/* Only renders for a coordinator with a round covering their
              course — it returns nothing otherwise. */}
          <CoordinatorQuestions />
          <FeedbackRequests />
        </div>
      ) : tab === "department" && caps.isHod ? (
        <DepartmentFeedback />
      ) : (
        <ResultsTab
          rows={rows}
          loading={loading}
          error={error}
          onRetry={load}
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
}: {
  rows: FeedbackOverviewRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const rowKey = (r: FeedbackOverviewRow) => `${r.period_id}:${r.course_id}`;
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = rows.filter((r) => r.results_visible);
  const overallAvg = useMemo(() => {
    const rated = visible.filter((r) => r.avg_rating !== null);
    if (rated.length === 0) return null;
    return (
      rated.reduce((sum, r) => sum + (r.avg_rating ?? 0), 0) / rated.length
    );
  }, [visible]);
  const totalResponses = rows.reduce((sum, r) => sum + r.response_count, 0);
  const collecting = rows.filter((r) => r.period_status === "open").length;

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
          hint="Across the results you can see"
        />
        <StatCard
          index={3}
          label="Still Collecting"
          value={collecting}
          icon={RefreshCw}
          tone={collecting > 0 ? "warning" : "neutral"}
          hint="Rounds open now"
        />
      </div>

      <SectionCard
        title="Course by course"
        description="Select a course to see its report. While a round is open the figures update as responses arrive."
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
              description="Once a feedback round covers a course you teach, its response progress appears here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {rows.map((r) => {
              const key = rowKey(r);
              const open = expanded === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : key)}
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
                      {r.period_status === "draft" ? (
                        <StatusBadge tone="neutral">Not open yet</StatusBadge>
                      ) : r.period_status === "open" ? (
                        <StatusBadge tone="success" dot>
                          Collecting
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="info">Closed</StatusBadge>
                      )}
                      {!r.results_visible && r.period_status !== "draft" && (
                        <StatusBadge tone="neutral" icon={Lock}>
                          {r.response_count} so far
                        </StatusBadge>
                      )}
                    </div>
                  </button>

                  {open && <ReportPanel row={r} />}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * One course's report, loaded when opened and kept current while the round is.
 *
 * A lecturer watching responses come in is the point of showing results
 * before the round closes, so an open round re-reads itself on a timer. A
 * closed one is finished and never will change, so it is fetched once and the
 * timer never starts.
 */
function ReportPanel({ row }: { row: FeedbackOverviewRow }) {
  const [report, setReport] = useState<CourseFeedbackReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [downloading, setDownloading] = useState(false);
  const live = row.period_status === "open";
  // Kept in a ref so the polling effect does not restart on every fetch.
  const loadRef = useRef<() => Promise<void>>();

  const load = useCallback(async () => {
    const result = await getCourseFeedbackReport(row.period_id, row.course_id);
    if (!result.ok) {
      setError(result.error);
    } else {
      setError(null);
      setReport(result.data);
      setRefreshedAt(new Date());
    }
    setLoading(false);
  }, [row.period_id, row.course_id]);

  loadRef.current = load;

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => loadRef.current?.(), LIVE_INTERVAL);
    return () => window.clearInterval(id);
  }, [live]);

  const download = () => {
    if (!report) return;
    setDownloading(true);
    try {
      buildFeedbackReportPdf(report).save(feedbackReportFilename(report));
    } catch (e) {
      console.error("[feedback pdf]", e);
      toast.error("We could not build the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="border-t border-border/70 bg-muted/20 px-4 py-4">
      {loading ? (
        <SkeletonRows count={4} height="h-10" />
      ) : error ? (
        <ErrorState message={error} size="inline" onRetry={load} />
      ) : !report ? null : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {live ? (
                <>
                  Updating as responses arrive
                  {refreshedAt &&
                    ` · last checked ${refreshedAt.toLocaleTimeString()}`}
                </>
              ) : (
                "This round has closed — these are the final results."
              )}
            </p>
            <div className="flex gap-2">
              {live && (
                <Button size="sm" variant="outline" onClick={load}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Refresh
                </Button>
              )}
              {/* The PDF is the record of a finished round. Offering it while
                  responses are still arriving would put a figure on paper
                  that the next student changes. */}
              {!live && report.visible && (
                <Button size="sm" onClick={download} disabled={downloading}>
                  <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {downloading ? "Building…" : "Download PDF"}
                </Button>
              )}
            </div>
          </div>

          <FeedbackReport report={report} />
        </div>
      )}
    </div>
  );
}
