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
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../../lib/settings";
import {
  type AttendanceCounts,
  type AttendanceTier,
  TIER_LABEL,
  classifyTier,
  compliantCount,
  getAbsencesAllowed,
  getLecturesNeededToRecover,
  percentageOf,
  totalCount,
} from "../../lib/attendanceMath";

interface CourseInfo {
  id: string;
  code: string;
  name: string;
}

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

  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [recordsByCourse, setRecordsByCourse] = useState<
    Record<string, AttendanceRecord[]>
  >({});
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
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

    const { data: enrollments, error: enrollError } = await supabase
      .from("enrollments")
      .select("course_id, courses(id, course_code, title)")
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    if (enrollError) {
      console.error("[Attendance] failed to load enrollments", enrollError);
      setError("We could not load your enrolled courses. Please try again.");
      setLoading(false);
      return;
    }

    const courseInfos: CourseInfo[] = (enrollments ?? [])
      .filter((e: any) => e.courses)
      .map((e: any) => ({
        id: e.courses.id,
        code: e.courses.course_code,
        name: e.courses.title,
      }));

    setCourses(courseInfos);

    if (courseInfos.length === 0) {
      setRecordsByCourse({});
      setLoading(false);
      return;
    }

    const { data: attData, error: attError } = await supabase
      .from("attendance")
      .select("course_id, status, lecture_date")
      .eq("student_id", student!.id)
      .in(
        "course_id",
        courseInfos.map((c) => c.id),
      );

    if (attError) {
      console.error("[Attendance] failed to load records", attError);
      setError("We could not load your attendance records. Please try again.");
      setLoading(false);
      return;
    }

    const grouped: Record<string, AttendanceRecord[]> = {};
    courseInfos.forEach((c) => (grouped[c.id] = []));
    (attData ?? []).forEach((r: any) => {
      grouped[r.course_id]?.push({ date: r.lecture_date, status: r.status });
    });
    setRecordsByCourse(grouped);

    // Default to the course needing the most attention — the lowest
    // attendance percentage among courses that actually have records.
    // Falls back to the first enrolled course when nothing has data yet.
    const withData = courseInfos
      .map((c) => ({
        course: c,
        counts: toCounts(grouped[c.id] ?? []),
      }))
      .filter((c) => totalCount(c.counts) > 0);

    const defaultCourse =
      withData.length > 0
        ? withData.reduce((worst, cur) =>
            percentageOf(cur.counts) < percentageOf(worst.counts) ? cur : worst,
          ).course
        : courseInfos[0];

    setSelectedCourseId(defaultCourse.id);
    setLoading(false);
  };

  /**
   * Per-course attendance, derived once. The overview list, the glance chart
   * and the selected-course stat cards all read from this rather than each
   * re-deriving the same percentages from the raw records.
   */
  const courseSummaries: CourseAttendanceSummary[] = useMemo(
    () =>
      courses.map((c) => {
        const counts = toCounts(recordsByCourse[c.id] ?? []);
        const total = totalCount(counts);
        const compliant = compliantCount(counts);
        const percentage = percentageOf(counts);
        return {
          id: c.id,
          code: c.code,
          name: c.name,
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
        };
      }),
    [courses, recordsByCourse, threshold, prewarning],
  );

  const selectedSummary =
    courseSummaries.find((s) => s.id === selectedCourseId) ?? null;
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null;
  const selectedRecords = selectedCourseId
    ? recordsByCourse[selectedCourseId] ?? []
    : [];
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
  const attendanceChartData = useMemo(
    () =>
      courseSummaries
        .filter((s) => s.total > 0)
        .map((s) => ({ code: s.code, percentage: s.percentage })),
    [courseSummaries],
  );
  const coursesAwaiting = courses.length - attendanceChartData.length;

  /** Overview → calendar, with the course the student tapped preselected. */
  const openCalendarFor = (courseId: string) => {
    setSelectedCourseId(courseId);
    setTab("calendar");
  };

  const allHistoryRecords: HistoryRecord[] = useMemo(
    () =>
      courses.flatMap((c) =>
        (recordsByCourse[c.id] ?? []).map((r) => ({
          date: r.date,
          status: r.status,
          courseCode: c.code,
          courseName: c.name,
        })),
      ),
    [courses, recordsByCourse],
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

  if (!loading && courses.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Attendance Tracker"
          description="Monitor your attendance course by course."
        />
        <EmptyState
          icon={CalendarX2}
          title="No enrolled courses"
          description="Attendance tracking appears here once you're enrolled in courses for the current semester."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance Tracker"
        description={`Monitor your attendance and stay above the ${threshold}% requirement, course by course.`}
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
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <label
                htmlFor="attendance-course-select"
                className="flex items-center gap-2 text-sm font-medium text-foreground sm:w-36 flex-shrink-0"
              >
                <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Viewing course
              </label>
              <Select
                value={selectedCourseId ?? undefined}
                onValueChange={setSelectedCourseId}
              >
                <SelectTrigger
                  id="attendance-course-select"
                  className="w-full sm:max-w-md h-11 text-sm"
                >
                  <SelectValue placeholder="Select a course" />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((c) => {
                    const counts = toCounts(recordsByCourse[c.id] ?? []);
                    const total = totalCount(counts);
                    const pct = percentageOf(counts);
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{c.code}</span>
                          <span className="text-muted-foreground truncate">
                            {c.name}
                          </span>
                          {total > 0 && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              ({pct}%)
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
                    key={selectedCourseId ?? "none"}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    transition={{ duration: reduce ? 0 : 0.2 }}
                  >
                    {selectedCourse && (
                      <AttendanceCalendar
                        courseCode={selectedCourse.code}
                        courseName={selectedCourse.name}
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
                  description="How attendance compares across your enrolled courses"
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

function toCounts(records: AttendanceRecord[]): AttendanceCounts {
  return {
    present: records.filter((r) => r.status === "present").length,
    absent: records.filter((r) => r.status === "absent").length,
    excused: records.filter((r) => r.status === "excused").length,
  };
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
