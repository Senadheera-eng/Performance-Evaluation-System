import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  Lock,
  Megaphone,
  MessageSquareText,
  Plus,
  RefreshCw,
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
  StatusBadge,
} from "../../components/common";
import { CoordinatorQuestions } from "../../components/staff/CoordinatorQuestions";
import { DepartmentFeedback } from "../../components/staff/DepartmentFeedback";
import { FeedbackReport } from "../../components/staff/FeedbackReport";
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

/** One feedback round, with the courses of it this lecturer teaches. */
interface Round {
  id: string;
  title: string;
  status: FeedbackOverviewRow["period_status"];
  type: FeedbackOverviewRow["feedback_type"];
  /** The round's own semester and batch, as the department set them. */
  semester: number | null;
  batchYear: number | null;
  academicYear: string | null;
  opensAt: string | null;
  closesAt: string | null;
  courses: FeedbackOverviewRow[];
}

const isClosed = (status: Round["status"]) =>
  status === "closed" || status === "archived";

const shortDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * A lecturer's feedback, a round at a time.
 *
 * The department opens a round — "Semester 5 Feedback, Batch 7, closes 19
 * October" — and the round is the thing a lecturer thinks in: it has a
 * cohort, a window, and the handful of their courses it covers. Listing every
 * course of every round together lost that, and made a lecturer who teaches
 * four courses across three rounds read twelve lines to find one report.
 *
 * So: open rounds and closed rounds, then the courses of a round, then one
 * course's report. A round's semester and batch are the round's own — a
 * department may quite properly run a Semester 6 round for a batch now in
 * Semester 7 — and are never inferred from where the batch happens to be.
 *
 * What may be shown is not decided here. Only courses this lecturer is
 * assigned to come back at all, results stay hidden until enough people have
 * answered to hide behind each other, and no answer carries a name. Those
 * rules live in the database, which enforces them whatever this page asks
 * for.
 */
export default function StaffFeedback() {
  const { staff } = useAuth();
  const caps = getStaffCapabilities(staff);
  const [tab, setTab] = useState("open");
  const [rows, setRows] = useState<FeedbackOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);

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

  /* Rounds, each carrying the courses of it this lecturer teaches. */
  const rounds = useMemo<Round[]>(() => {
    const map = new Map<string, Round>();
    for (const r of rows) {
      const found = map.get(r.period_id);
      if (found) {
        found.courses.push(r);
        continue;
      }
      map.set(r.period_id, {
        id: r.period_id,
        title: r.period_title,
        status: r.period_status,
        type: r.feedback_type,
        semester: r.period_semester,
        batchYear: r.period_batch_year,
        academicYear: r.period_academic_year,
        opensAt: r.opens_at,
        closesAt: r.closes_at,
        courses: [r],
      });
    }
    return [...map.values()].sort(
      (a, b) =>
        (b.closesAt ?? "").localeCompare(a.closesAt ?? "") ||
        a.title.localeCompare(b.title),
    );
  }, [rows]);

  const openRounds = rounds.filter((r) => !isClosed(r.status));
  const closedRounds = rounds.filter((r) => isClosed(r.status));
  const shown = tab === "closed" ? closedRounds : openRounds;

  /* Land on the first round of whichever list is showing, so the page is
     never a list beside an empty panel. */
  useEffect(() => {
    if (shown.length === 0) {
      setSelectedRound(null);
      return;
    }
    if (!shown.some((r) => r.id === selectedRound)) {
      setSelectedRound(shown[0].id);
      setSelectedCourse(null);
    }
  }, [shown, selectedRound]);

  const round = shown.find((r) => r.id === selectedRound) ?? null;
  const course =
    round?.courses.find((c) => c.course_id === selectedCourse) ?? null;

  const header = (
    <FeedbackHeader
      isHod={caps.isHod}
      tab={tab}
      setTab={setTab}
      openCount={openRounds.length}
      closedCount={closedRounds.length}
    />
  );

  if (caps.isHod && tab === "department") {
    return (
      <div className="space-y-5">
        {header}
        <DepartmentFeedback />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SectionCard title="Feedback rounds">
          <SkeletonRows count={4} height="h-16" />
        </SectionCard>
      ) : rounds.length === 0 ? (
        <SectionCard title="Feedback rounds" flush>
          <div className="p-4">
            <EmptyState
              icon={MessageSquareText}
              title="No feedback rounds yet"
              description="When your department opens a round covering a course you teach, it appears here. You can ask for one below."
            />
          </div>
        </SectionCard>
      ) : shown.length === 0 ? (
        <SectionCard
          title={tab === "closed" ? "Closed feedback" : "Open feedback"}
          flush
        >
          <div className="p-4">
            <EmptyState
              icon={MessageSquareText}
              title={
                tab === "closed"
                  ? "Nothing has closed yet"
                  : "No round is open right now"
              }
              description={
                tab === "closed"
                  ? "Once your department closes a round, its final report appears here."
                  : "Closed rounds and their reports are under Closed feedback."
              }
            />
          </div>
        </SectionCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <SectionCard
            title={tab === "closed" ? "Closed rounds" : "Open rounds"}
            description={
              tab === "closed"
                ? "Rounds your department has closed."
                : "Rounds collecting answers now."
            }
            flush
          >
            <ul className="divide-y divide-border/70">
              {shown.map((r) => {
                const active = r.id === round?.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRound(r.id);
                        setSelectedCourse(null);
                      }}
                      aria-current={active}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                        active ? "bg-primary/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <Megaphone
                            className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="truncate text-sm font-medium text-foreground">
                            {r.title}
                          </span>
                          <RoundBadge status={r.status} />
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {r.semester ? `Semester ${r.semester} · ` : ""}
                          {r.batchYear ? describeBatch(r.batchYear) : "All batches"}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {isClosed(r.status) ? "Closed on " : "Closes on "}
                          {shortDate(r.closesAt)} · {r.courses.length} of your
                          course{r.courses.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <ChevronRight
                        className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          <div className="min-w-0 space-y-4">
            {round && !course && (
              <>
                <SectionCard
                  title={`Your courses in ${round.title}`}
                  description="Only the courses you are assigned to. Open one for its results."
                  actions={<RoundBadge status={round.status} />}
                  flush
                >
                  <ul className="divide-y divide-border/70">
                    {round.courses.map((c) => (
                      <li key={c.course_id}>
                        <button
                          type="button"
                          onClick={() => setSelectedCourse(c.course_id)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                        >
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <FileText
                                className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                              <span className="text-sm font-semibold text-primary">
                                {c.course_code}
                              </span>
                              <span className="truncate text-sm text-foreground">
                                {c.course_title}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              <Users
                                className="mr-1 inline h-3 w-3"
                                aria-hidden="true"
                              />
                              {c.eligible_count} student
                              {c.eligible_count === 1 ? "" : "s"} ·{" "}
                              {c.response_count} response
                              {c.response_count === 1 ? "" : "s"} (
                              {c.response_rate}%)
                            </span>
                          </span>
                          <span className="flex flex-shrink-0 items-center gap-2">
                            {c.avg_rating !== null && (
                              <span className="text-right">
                                <span className="block text-sm font-semibold tabular-nums text-foreground">
                                  {c.avg_rating.toFixed(2)}
                                </span>
                                <span className="block text-[11px] text-muted-foreground">
                                  avg
                                </span>
                              </span>
                            )}
                            {c.results_visible ? (
                              isClosed(round.status) ? (
                                <StatusBadge tone="info">Report ready</StatusBadge>
                              ) : (
                                <StatusBadge tone="success" dot>
                                  Collecting
                                </StatusBadge>
                              )
                            ) : (
                              <StatusBadge tone="neutral" icon={Lock}>
                                {c.response_count} so far
                              </StatusBadge>
                            )}
                            <ChevronRight
                              className="h-4 w-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </SectionCard>

                <RoundSummary round={round} />
              </>
            )}

            {round && course && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2"
                  onClick={() => setSelectedCourse(null)}
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  Back to {round.title}
                </Button>
                <ReportPanel row={course} round={round} />
              </>
            )}
          </div>
        </div>
      )}

      {/* Both render nothing when there is nothing to do: no round whose
          questions this coordinator may still change, and no form asked for. */}
      <CoordinatorQuestions />
      <div id="request-a-form">
        <FeedbackRequests />
      </div>
    </div>
  );
}

function FeedbackHeader({
  isHod,
  tab,
  setTab,
  openCount,
  closedCount,
}: {
  isHod: boolean;
  tab: string;
  setTab: (value: string) => void;
  openCount: number;
  closedCount: number;
}) {
  return (
    <>
      <PageHeader
        title="Feedback"
        description="Pick a round to see your courses in it, read the results, and download the report once it closes."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              document
                .getElementById("request-a-form")
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Request a form
          </Button>
        }
      />
      <SegmentedTabs
        tabs={[
          { value: "open", label: "Open feedback", count: openCount },
          { value: "closed", label: "Closed feedback", count: closedCount },
          // The department view belongs to the appointment, not the role, so
          // it appears and disappears with the headship. The RPCs behind it
          // refuse anyone who is not the sitting head regardless.
          ...(isHod ? [{ value: "department", label: "Department" }] : []),
        ]}
        value={tab}
        onChange={setTab}
        layoutId="staff-feedback-tabs"
        aria-label="Feedback view"
      />
    </>
  );
}

function RoundBadge({ status }: { status: Round["status"] }) {
  if (status === "open") {
    return (
      <StatusBadge tone="success" dot>
        Open
      </StatusBadge>
    );
  }
  if (isClosed(status)) return <StatusBadge tone="neutral">Closed</StatusBadge>;
  return <StatusBadge tone="warning">Not open yet</StatusBadge>;
}

/** The round's own facts, stated once under its courses. */
function RoundSummary({ round }: { round: Round }) {
  const fields: [string, string][] = [
    ["Round", round.title],
    ["Type", round.type === "mid_semester" ? "Mid semester" : "End semester"],
    ["Semester", round.semester ? `Semester ${round.semester}` : "—"],
    ["Batch", round.batchYear ? describeBatch(round.batchYear) : "All batches"],
    ["Academic year", round.academicYear ?? "—"],
    ["Opened", shortDate(round.opensAt)],
    [isClosed(round.status) ? "Closed" : "Closes", shortDate(round.closesAt)],
  ];
  return (
    <SectionCard title="About this round" description="As your department set it.">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
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
function ReportPanel({
  row,
  round,
}: {
  row: FeedbackOverviewRow;
  round: Round;
}) {
  const [report, setReport] = useState<CourseFeedbackReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [downloading, setDownloading] = useState(false);
  const live = round.status === "open";
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
    <SectionCard
      title={`${row.course_code} — ${row.course_title}`}
      description={`${row.response_count} of ${row.eligible_count} responded (${row.response_rate}%) · answers are anonymous`}
      actions={
        <div className="flex flex-wrap gap-2">
          {live && (
            <Button size="sm" variant="outline" onClick={load}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </Button>
          )}
          {/* The PDF is the record of a finished round. Offering it while
              responses are still arriving would put a figure on paper that
              the next student changes. */}
          {!live && report?.visible && (
            <Button size="sm" onClick={download} disabled={downloading}>
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {downloading ? "Building…" : "Download final report"}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <p
          className={`rounded-xl border px-3 py-2 text-xs ${
            live
              ? "border-success-border bg-success-bg text-success-fg"
              : "border-border bg-muted/50 text-muted-foreground"
          }`}
        >
          {live ? (
            <>
              Feedback is currently being collected. Results update as responses
              arrive
              {refreshedAt && ` · last checked ${refreshedAt.toLocaleTimeString()}`}
              .
            </>
          ) : (
            "Feedback round closed — this is the final report."
          )}
        </p>

        {loading ? (
          <SkeletonRows count={4} height="h-10" />
        ) : error ? (
          <ErrorState message={error} size="inline" onRetry={load} />
        ) : !report ? null : (
          <FeedbackReport report={report} />
        )}
      </div>
    </SectionCard>
  );
}
