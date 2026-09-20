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
  getMyTeaching,
  type CourseFeedbackReport,
  type FeedbackOverviewRow,
  type TeachingOffering,
} from "../../../lib/staffService";

/** How often an open round's report re-reads itself, in milliseconds. */
const LIVE_INTERVAL = 30_000;

/**
 * A lecturer's own feedback, in the order they need it.
 *
 * The job is short: see the round on a course you teach, read what came back,
 * download the report once it closes, and ask for a form when there is no
 * round. That was spread over two tabs and three sections, one of which
 * usually only said the form was fixed and there was nothing to do.
 *
 * So: one list of courses, results first, and sections that have nothing to
 * offer do not appear at all. The head of department's view of the whole
 * department stays behind its own tab — a different job, and only for the
 * sitting head.
 *
 * Response progress is always visible — knowing how many people replied
 * identifies nobody, and it is what tells a lecturer whether to chase their
 * class. What students actually said waits for two things: the round to be
 * open, and enough people to have answered that no single reply can be picked
 * out of the report. Both rules live in the database; this page only reflects
 * them.
 */
export default function StaffFeedback() {
  const { staff } = useAuth();
  const caps = getStaffCapabilities(staff);
  const [tab, setTab] = useState("mine");
  const [rows, setRows] = useState<FeedbackOverviewRow[]>([]);
  const [teaching, setTeaching] = useState<TeachingOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [overview, mine] = await Promise.all([
      getMyFeedbackOverview(),
      getMyTeaching(),
    ]);
    if (!overview.ok) {
      setError("We could not load your feedback. Please try again.");
      setLoading(false);
      return;
    }
    setRows(overview.data);
    if (mine.ok) setTeaching(mine.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (staff) load();
  }, [staff?.lecturerId, load]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feedback"
        description="What your students said about the courses you teach."
      />

      {/* Only a head of department has a second view to switch to. */}
      {caps.isHod && (
        <SegmentedTabs
          tabs={[
            { value: "mine", label: "My courses" },
            { value: "department", label: "Department" },
          ]}
          value={tab}
          onChange={setTab}
          layoutId="staff-feedback-tabs"
          aria-label="Feedback view"
        />
      )}

      {caps.isHod && tab === "department" ? (
        <DepartmentFeedback />
      ) : (
        <>
          <ResultsTab
            rows={rows}
            teaching={teaching}
            loading={loading}
            error={error}
            onRetry={load}
          />
          {/* Both render nothing when there is nothing to do: no round whose
              questions this coordinator may still change, and no form
              requested. */}
          <CoordinatorQuestions />
          <FeedbackRequests />
        </>
      )}
    </div>
  );
}

/** How a round sorts: what is open comes first, what has finished last. */
const STATUS_ORDER: Record<string, number> = {
  open: 0,
  draft: 1,
  scheduled: 1,
  closed: 2,
  archived: 3,
};

function ResultsTab({
  rows,
  teaching,
  loading,
  error,
  onRetry,
}: {
  rows: FeedbackOverviewRow[];
  teaching: TeachingOffering[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const rowKey = (r: FeedbackOverviewRow) => `${r.period_id}:${r.course_id}`;
  const [expanded, setExpanded] = useState<string | null>(null);

  /* Courses being taught this semester that no round covers yet. Without
     them the page could only show what already exists, and a lecturer
     wondering "where is my feedback?" had nothing to act on. */
  const awaitingRound = useMemo(
    () =>
      teaching.filter(
        (o) => o.is_current && !rows.some((r) => r.course_id === o.course_id),
      ),
    [teaching, rows],
  );

  /* Open rounds first, then anything not yet open, then closed ones —
     within each, the course being taught now before older deliveries. */
  const ordered = useMemo(() => {
    const currentCourses = new Set(
      teaching.filter((o) => o.is_current).map((o) => o.course_id),
    );
    return [...rows].sort(
      (a, b) =>
        (STATUS_ORDER[a.period_status] ?? 9) - (STATUS_ORDER[b.period_status] ?? 9) ||
        Number(currentCourses.has(b.course_id)) -
          Number(currentCourses.has(a.course_id)) ||
        b.semester - a.semester ||
        a.course_code.localeCompare(b.course_code),
    );
  }, [rows, teaching]);

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
        title="Your courses"
        description="Open a course to read its report. While a round is open the figures update as responses arrive; once your department closes it, the report can be downloaded."
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={4} height="h-16" />
          </div>
        ) : rows.length === 0 && awaitingRound.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={MessageSquareText}
              title="No feedback yet"
              description="Once a feedback round covers a course you teach, its response progress appears here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {awaitingRound.map((o) => (
              <li
                key={o.offering_id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-primary">
                      {o.course_code}
                    </span>
                    <span className="truncate text-sm text-foreground">
                      {o.course_title}
                    </span>
                    <StatusBadge tone="success">This semester</StatusBadge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {describeBatch(o.batch_year)} · Semester {o.semester} · no
                    feedback round yet
                  </p>
                </div>
                <StatusBadge tone="neutral">Nothing to show</StatusBadge>
              </li>
            ))}
            {ordered.map((r) => {
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
