import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  BookOpen,
  CalendarCheck2,
  CalendarX2,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { cn } from "../components/ui/utils";
import {
  CourseAttendanceChart,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedTabs,
  Skeleton,
  SkeletonRows,
  SkeletonStatGrid,
  StatCard,
  StatusBadge,
  DepartmentDot,
  type StatusTone,
} from "../components/common";
import { SignInToLecture } from "../components/attendance/SignInToLecture";
import {
  AttendanceCalendar,
  type AttendanceRecord,
} from "../components/attendance/AttendanceCalendar";
import {
  AttendanceOverview,
  TIER_ICON,
  TIER_TONE,
  type CourseAttendanceSummary,
} from "../components/attendance/AttendanceOverview";
import {
  AttendanceHistoryList,
  type HistoryRecord,
} from "../components/attendance/AttendanceHistoryList";
import { useAuth } from "../context/AuthContext";
import { departmentByCourseCode } from "../../lib/departments";
import { useSettings } from "../../lib/settings";
import {
  type AttendanceCounts,
  type AttendanceTier,
  TIER_LABEL,
  classifyTier,
  compliantCount,
  getAbsencesAllowed,
  getLecturesNeededToRecover,
} from "../../lib/attendanceMath";
import {
  type CourseDelivery,
  type Term,
  deliveryLabel,
  getCurrentTermAttendance,
  termLabel,
} from "../../lib/studentAttendance";

const TABS = [
  { value: "overview", label: "Attendance" },
  { value: "calendar", label: "Calendar View" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

export default function Attendance() {
  const { student } = useAuth();
  const settings = useSettings();
  const threshold = settings.attendanceThreshold;
  const prewarning = settings.attendancePrewarningThreshold;
  const reduce = useReducedMotion();

  /* One entry per delivery: a repeated course appears once per attempt, each
     with its own register, so the two are never averaged together. */
  const [deliveries, setDeliveries] = useState<CourseDelivery[]>([]);
  /* The term being taught now. Only its courses are shown: an earlier term's
     register is closed and can neither be improved nor lost. */
  const [term, setTerm] = useState<Term | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Opens on the all-course overview: "am I in trouble anywhere?" is the
  // question students arrive with, and the calendar can only answer it one
  // course at a time.
  const [tab, setTab] = useState<TabValue>("overview");

  useEffect(() => {
    if (!student?.id) return;
    fetchAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  const fetchAttendance = async () => {
    setLoading(true);
    setError(null);

    const result = await getCurrentTermAttendance();
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    const loaded = result.data.deliveries;
    setDeliveries(loaded);
    setTerm(result.data.term);

    // Default to the delivery needing the most attention — the lowest
    // percentage among those that have records, preferring one still being
    // taught, since a term that has ended can no longer be recovered.
    const open = loaded.filter((d) => d.is_latest_attempt && d.lectures > 0);
    const worst = open.reduce<CourseDelivery | null>(
      (lowest, d) =>
        lowest === null || (d.percentage ?? 0) < (lowest.percentage ?? 0) ? d : lowest,
      null,
    );
    setSelectedKey((worst ?? loaded[0])?.delivery_key ?? null);
    setLoading(false);
  };

  /**
   * Per-delivery attendance, derived once. The overview list, the glance chart
   * and the selected-course stat cards all read from this rather than each
   * re-deriving the same percentages from the raw records.
   */
  const courseSummaries: CourseAttendanceSummary[] = useMemo(
    () =>
      deliveries.map((d) => {
        const counts: AttendanceCounts = {
          present: d.present,
          absent: d.absent,
          excused: d.excused,
        };
        const total = d.lectures;
        const compliant = compliantCount(counts);
        const percentage = d.percentage ?? 0;
        return {
          id: d.delivery_key,
          code: d.course_code,
          name: d.title,
          counts,
          total,
          percentage,
          tier: classifyTier(percentage, total, threshold, prewarning),
          absencesAllowed: getAbsencesAllowed(compliant, total, threshold),
          lecturesNeeded: getLecturesNeededToRecover(
            compliant,
            total,
            threshold,
          ),
          attempt: d.has_repeat
            ? {
                label: `Attempt ${d.attempt_number} · ${d.academic_year}`,
                isLatest: d.is_latest_attempt,
              }
            : undefined,
        };
      }),
    [deliveries, threshold, prewarning],
  );

  const selectedSummary =
    courseSummaries.find((s) => s.id === selectedKey) ?? null;
  const selectedCourse = deliveries.find((d) => d.delivery_key === selectedKey) ?? null;
  const selectedRecords: AttendanceRecord[] = useMemo(
    () =>
      (selectedCourse?.sessions ?? []).map((s) => ({
        date: s.date,
        status: s.status,
      })),
    [selectedCourse],
  );
  const selectedCounts = selectedSummary?.counts ?? {
    present: 0,
    absent: 0,
    excused: 0,
  };
  const selectedTotal = selectedSummary?.total ?? 0;
  const selectedPercentage = selectedSummary?.percentage ?? 0;
  const selectedTier: AttendanceTier = selectedSummary?.tier ?? "pending";
  const absencesAllowed = selectedSummary?.absencesAllowed ?? 0;
  const lecturesNeeded = selectedSummary?.lecturesNeeded ?? 0;

  // "All courses at a glance" chart — courses with no recorded lecture yet
  // are excluded and counted separately, same rule the summary math uses.
  // A superseded attempt is left out: the chart compares the courses the
  // student is judged on now, and an old attempt's bar sits under the same
  // code as the current one and reads as a contradiction.
  const attendanceChartData = useMemo(
    () =>
      deliveries
        .filter((d) => d.is_latest_attempt && d.lectures > 0)
        .map((d) => ({ code: d.course_code, percentage: d.percentage ?? 0 })),
    [deliveries],
  );
  const coursesAwaiting = deliveries.filter(
    (d) => d.is_latest_attempt && d.lectures === 0,
  ).length;

  /** Overview → calendar, with the delivery the student tapped preselected. */
  const openCalendarFor = (deliveryKey: string) => {
    setSelectedKey(deliveryKey);
    setTab("calendar");
  };

  const allHistoryRecords: HistoryRecord[] = useMemo(
    () =>
      deliveries.flatMap((d) =>
        d.sessions.map((s) => ({
          date: s.date,
          status: s.status,
          courseCode: deliveryLabel(d),
          courseName: d.title,
        })),
      ),
    [deliveries],
  );

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Attendance Tracker"
          description="Monitor your attendance course by course."
        />
        <ErrorState message={error} onRetry={fetchAttendance} />
      </div>
    );
  }

  if (!loading && deliveries.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Attendance Tracker"
          description="Monitor your attendance course by course."
        />
        <EmptyState
          icon={CalendarX2}
          title="No courses this semester"
          description="Attendance tracking appears here once you are enrolled on courses for the current semester, or once a lecture of yours is marked."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={term ? termLabel(term) : undefined}
        title="Attendance Tracker"
        description={`This semester's courses, course by course, against the ${threshold}% requirement.`}
      />

      {/* Renders nothing unless a lecturer has a register open on one of this
          student's courses, so it costs an ordinary visit nothing. */}
      <SignInToLecture onCheckedIn={fetchAttendance} />

      <SegmentedTabs
        aria-label="Attendance view"
        value={tab}
        onChange={(v) => setTab(v as TabValue)}
        layoutId="attendance-view-tabs"
        tabs={TABS.map((t) => ({ value: t.value, label: t.label }))}
      />

      {/* Keyed on the active tab so each switch plays a real transition
          rather than swapping the panel in instantly. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16 }}
          transition={{ duration: reduce ? 0 : 0.18, ease: [0.4, 0, 0.2, 1] }}
          className="space-y-5"
        >
          {tab === "overview" ? (
          loading ? (
            <div className="space-y-4">
              <SkeletonStatGrid count={5} />
              <SkeletonRows count={6} height="h-16" />
            </div>
          ) : (
            <AttendanceOverview
              summaries={courseSummaries}
              threshold={threshold}
              onOpenCalendar={openCalendarFor}
            />
          )
        ) : (
          <>
          {/* Course selector — deliberately its own full-width, clearly labelled
              row rather than a small control tucked into the header, which
              students found easy to miss and didn't read as a dropdown at all. */}
          {loading ? (
            <Skeleton className="h-[52px] w-full" />
          ) : (
            <div
              className={cn(
                "flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border border-border border-l-4 bg-card px-4 py-3",
                departmentByCourseCode(selectedCourse?.course_code)?.stripeClass,
              )}
            >
              <label
                htmlFor="attendance-course-select"
                className="flex items-center gap-2 text-sm font-medium text-foreground sm:w-36 flex-shrink-0"
              >
                <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Viewing course
              </label>
              <Select
                value={selectedKey ?? undefined}
                onValueChange={setSelectedKey}
              >
                <SelectTrigger
                  id="attendance-course-select"
                  className="w-full sm:max-w-md h-11 text-sm"
                >
                  <SelectValue placeholder="Select a course" />
                </SelectTrigger>
                <SelectContent>
                  {deliveries.map((d) => {
                    const dept = departmentByCourseCode(d.course_code);
                    return (
                    <SelectItem
                      key={d.delivery_key}
                      value={d.delivery_key}
                      className={dept?.optionClass}
                    >
                      <span className="flex items-center gap-2">
                        {dept && <DepartmentDot dept={dept} className="h-2.5 w-2.5" />}
                        <span className={cn("font-semibold", dept?.textClass)}>
                          {deliveryLabel(d)}
                        </span>
                        <span className="text-muted-foreground truncate">
                          {d.title}
                        </span>
                        {d.lectures > 0 && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            ({d.percentage}%)
                          </span>
                        )}
                      </span>
                    </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {loading ? (
            <SkeletonStatGrid count={6} />
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <StatCard
                index={0}
                label="Attendance"
                value={`${selectedPercentage}%`}
                icon={TIER_ICON[selectedTier]}
                tone={TIER_TONE[selectedTier]}
                hint={TIER_LABEL[selectedTier]}
              />
              <StatCard
                index={1}
                label="Total Lectures"
                value={selectedTotal}
                icon={CalendarCheck2}
                tone="neutral"
              />
              <StatCard
                index={2}
                label="Present"
                value={selectedCounts.present}
                icon={CheckCircle2}
                tone="success"
              />
              <StatCard
                index={3}
                label="Absent"
                value={selectedCounts.absent}
                icon={CalendarX2}
                tone="danger"
              />
              <StatCard
                index={4}
                label="Excused"
                value={selectedCounts.excused}
                icon={ShieldCheck}
                tone="info"
              />
              <StatCard
                index={5}
                label="Absences Allowed"
                value={absencesAllowed}
                icon={AlertTriangle}
                tone={absencesAllowed === 0 && selectedTotal > 0 ? "danger" : "neutral"}
                hint={`Before dropping below ${threshold}%`}
              />
            </div>
          )}

          {!loading && selectedCourse && (
            <StatusMessage
              tier={selectedTier}
              threshold={threshold}
              percentage={selectedPercentage}
              absencesAllowed={absencesAllowed}
              lecturesNeeded={lecturesNeeded}
            />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
            <div className="lg:col-span-3">
              {loading ? (
                <Skeleton className="h-[480px] w-full" />
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedKey ?? "none"}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    transition={{ duration: reduce ? 0 : 0.2 }}
                  >
                    {selectedCourse && (
                      <AttendanceCalendar
                        courseCode={deliveryLabel(selectedCourse)}
                        courseName={selectedCourse.title}
                        records={selectedRecords}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>

            <div className="lg:col-span-2">
              {loading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <CourseAttendanceChart
                  title="All courses at a glance"
                  description="How attendance compares across this semester's courses"
                  data={attendanceChartData}
                  threshold={threshold}
                  prewarning={prewarning}
                  awaitingCount={coursesAwaiting}
                />
              )}
            </div>
          </div>

          {loading ? (
            <SkeletonRows count={5} height="h-12" />
          ) : (
            <AttendanceHistoryList records={allHistoryRecords} />
          )}
          </>
        )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function StatusMessage({
  tier,
  threshold,
  percentage,
  absencesAllowed,
  lecturesNeeded,
}: {
  tier: AttendanceTier;
  threshold: number;
  percentage: number;
  absencesAllowed: number;
  lecturesNeeded: number;
}) {
  const Icon = TIER_ICON[tier];
  const tone = TIER_TONE[tier];

  const copy: Record<AttendanceTier, string> = {
    pending:
      "No lectures have been recorded for this course yet — attendance will appear here once your department admin starts marking it.",
    critical: `You are below the ${threshold}% requirement at ${percentage}%. You are not currently eligible — attend the next ${lecturesNeeded} lecture${
      lecturesNeeded === 1 ? "" : "s"
    } with zero further absences to recover.`,
    at_risk: `You're at ${percentage}%, above the ${threshold}% requirement but close to it. You can afford ${absencesAllowed} more absence${
      absencesAllowed === 1 ? "" : "s"
    } before falling below the requirement.`,
    safe: `You're at ${percentage}%, comfortably above the ${threshold}% requirement. You can afford ${absencesAllowed} more absence${
      absencesAllowed === 1 ? "" : "s"
    } while staying compliant.`,
    excellent: `Excellent attendance at ${percentage}%. You can afford ${absencesAllowed} more absence${
      absencesAllowed === 1 ? "" : "s"
    } while staying above ${threshold}%.`,
  };

  const BG_BORDER: Record<StatusTone, string> = {
    success: "bg-success-bg border-success-border",
    info: "bg-info-bg border-info-border",
    warning: "bg-warning-bg border-warning-border",
    danger: "bg-danger-bg border-danger-border",
    neutral: "bg-neutral-bg border-neutral-border",
    brand: "bg-primary/10 border-primary/20",
  };
  const ICON_COLOR: Record<StatusTone, string> = {
    success: "text-success-fg",
    info: "text-info-fg",
    warning: "text-warning-fg",
    danger: "text-danger-fg",
    neutral: "text-neutral-fg",
    brand: "text-primary",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3",
        BG_BORDER[tone],
      )}
    >
      <Icon
        className={cn("h-4.5 w-4.5 mt-0.5 flex-shrink-0", ICON_COLOR[tone])}
        aria-hidden="true"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge tone={tone}>{TIER_LABEL[tier]}</StatusBadge>
        <p className="text-sm text-foreground">{copy[tier]}</p>
      </div>
    </div>
  );
}
