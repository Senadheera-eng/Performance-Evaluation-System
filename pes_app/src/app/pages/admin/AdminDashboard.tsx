import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  BookOpen,
  Calendar,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Clock,
  PartyPopper,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  ActionCard,
  AnimatedNumber,
  CourseAttendanceChart,
  CourseCode,
  EmptyState,
  ErrorState,
  HeroCard,
  PageHeader,
  PillTabs,
  ProgressRing,
  SectionCard,
  SkeletonHero,
  SkeletonRows,
  StatStrip,
  StatusBadge,
  TabPanel,
  gradeTone,
  heroGhostButtonClass,
} from "../../components/common";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getAdminScope, describeAdminReach } from "../../../lib/adminScope";
import { getAdminOfferings } from "../../../lib/attendanceRegister";
import { useSettings } from "../../../lib/settings";
import { formatRegNumber } from "../../../lib/format";
import { courseRowClass } from "../../../lib/departments";
import { DepartmentBreakdown } from "../../components/admin/DepartmentBreakdown";
import { FacultyWebsiteCard } from "../../components/admin/FacultyWebsiteCard";

interface DashboardStats {
  totalStudents: number;
  totalCourses: number;
  /** Deliveries whose semester is the one their batch is sitting now. */
  coursesRunning: number;
  activeEnrolments: number;
  avgAttendance: number;
}

interface AttendanceAlert {
  studentName: string;
  regNumber: string;
  courseCode: string;
  courseName: string;
  percentage: number;
}

interface CourseAttendanceStat {
  code: string;
  avgAttendance: number;
}

interface RecentResult {
  id: string;
  studentName: string;
  regNumber: string;
  indexNumber: string;
  courseCode: string;
  courseName: string;
  grade: string;
  publishedAt: string | null;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { student } = useAuth();
  const settings = useSettings();
  const scope = getAdminScope(student);
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    totalCourses: 0,
    coursesRunning: 0,
    activeEnrolments: 0,
    avgAttendance: 0,
  });
  const [alerts, setAlerts] = useState<AttendanceAlert[]>([]);
  const [courseAttendance, setCourseAttendance] = useState<
    CourseAttendanceStat[]
  >([]);
  const [coursesAwaitingAttendance, setCoursesAwaitingAttendance] = useState(0);
  const [recentResults, setRecentResults] = useState<RecentResult[]>([]);
  const [recentResultsError, setRecentResultsError] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [chartTab, setChartTab] = useState<"courses" | "departments">("courses");

  useEffect(() => {
    if (student) fetchDashboardData();
  }, [student]);

  const fetchDashboardData = async () => {
    setLoading(true);
    await Promise.all([
      fetchStats(),
      fetchAttendanceOverview(),
      fetchRecentResults(),
    ]);
    setLoading(false);
  };

  const fetchStats = async () => {
    // Total courses (scoped to this admin's department — courses stay
    // broadly SELECT-able by RLS so students can browse the full
    // catalogue, so this filter is applied client-side for the admin view)
    let courseCountQuery = supabase
      .from("courses")
      .select("*", { count: "exact", head: true });
    if (scope.kind === "department") {
      courseCountQuery = courseCountQuery.eq("department", scope.department);
    }

    // Four counts, independent of each other, so they go out together
    // rather than one after another.
    const [
      { count: studentCount },
      { count: courseCount },
      { count: activeCount },
      offerings,
    ] = await Promise.all([
        supabase
          .from("students")
          .select("*", { count: "exact", head: true })
          .eq("role", "student")
          .eq("status", "active"),
        courseCountQuery,
        supabase
          .from("enrollments")
          .select("course_id", { count: "exact", head: true })
          .eq("status", "enrolled"),
        getAdminOfferings(),
      ]);

    setStats((prev) => ({
      ...prev,
      totalStudents: studentCount ?? 0,
      totalCourses: courseCount ?? 0,
      /* What the department is actually teaching this semester. The card
         used to show every enrolment row with status 'enrolled' under the
         heading "Current semester", which is a different thing and only
         looked right while one batch existed. */
      coursesRunning: offerings.ok
        ? offerings.data.filter((o) => o.is_current).length
        : 0,
      activeEnrolments: activeCount ?? 0,
    }));
  };

  /* The average, the below-80% alerts and the per-course chart all come
     from one RPC. This page used to download the whole attendance table
     three times, plus every enrolment, and add it up here — which past
     PostgREST's 1000-row page does not just get slow, it gets the numbers
     wrong without saying so. */
  const fetchAttendanceOverview = async () => {
    const { data, error } = await supabase.rpc(
      "get_admin_attendance_overview",
      { p_alert_limit: 5 },
    );
    if (error || !data) {
      console.error("[AdminDashboard] failed to load attendance", error);
      return;
    }
    const overview = data as {
      average: number;
      alerts: AttendanceAlert[];
      courses: CourseAttendanceStat[];
      awaiting: number;
    };
    setStats((prev) => ({ ...prev, avgAttendance: overview.average }));
    setAlerts(overview.alerts);
    setCourseAttendance(overview.courses);
    setCoursesAwaitingAttendance(overview.awaiting);
  };

  // Client-side joins to students/courses fail RLS for any student outside
  // the admin's own department — routine for shared first/second-year
  // courses, which have students from all four departments by design. That
  // silently produced "—" for the name instead of an error. This RPC
  // resolves the join server-side, scoped to the admin's department (or all
  // departments for super_admin) the same way get_course_roster does.
  const fetchRecentResults = async () => {
    setRecentResultsError(null);
    const { data, error } = await supabase.rpc("get_admin_recent_results", {
      p_limit: 5,
    });

    if (error) {
      console.error("[AdminDashboard] failed to load recent results", error);
      setRecentResultsError("Unable to load recent results.");
      return;
    }

    setRecentResults(
      (data ?? []).map((r: any) => ({
        id: r.result_id,
        studentName: r.student_name ?? "—",
        regNumber: formatRegNumber(r.reg_number),
        indexNumber: r.index_number ?? "—",
        courseCode: r.course_code ?? "—",
        courseName: r.course_title ?? "—",
        grade: r.grade,
        publishedAt: r.published_at,
      })),
    );
  };

  /* The overview reports an average of 0 when no lecture has been marked
     anywhere, which read as a department with nobody attending. Until a
     course has a recorded lecture there is no average to show. */
  const attendanceRecorded = courseAttendance.length > 0;

  /* One line under the chart saying what it shows, from the very numbers
     it draws. */
  const lowest = courseAttendance.reduce<CourseAttendanceStat | null>(
    (lo, c) => (lo === null || c.avgAttendance < lo.avgAttendance ? c : lo),
    null,
  );
  const below = courseAttendance.filter((c) => c.avgAttendance < settings.attendanceThreshold).length;
  const chartTakeaway = lowest
    ? below > 0
      ? `${lowest.code} is lowest at ${lowest.avgAttendance}%. ${below} of ${courseAttendance.length} courses are below ${settings.attendanceThreshold}%.`
      : `Every course with recorded lectures is at or above ${settings.attendanceThreshold}%; the lowest is ${lowest.code} at ${lowest.avgAttendance}%.`
    : undefined;

  const attendanceTone = !attendanceRecorded
    ? "neutral"
    : stats.avgAttendance < settings.attendanceThreshold
      ? "danger"
      : stats.avgAttendance < settings.attendancePrewarningThreshold
        ? "warning"
        : "success";

  const chart = (
    <CourseAttendanceChart
      bare
      title="Course attendance"
      description="Lowest first — the courses needing attention"
      data={courseAttendance.map((c) => ({
        code: c.code,
        percentage: c.avgAttendance,
      }))}
      threshold={settings.attendanceThreshold}
      prewarning={settings.attendancePrewarningThreshold}
      awaitingCount={coursesAwaitingAttendance}
      limit={10}
      loading={loading}
      takeaway={chartTakeaway}
    />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin Dashboard"
        description={`Overview of ${describeAdminReach(student)}.`}
      />

      {/* The department (or faculty) at a glance, beside the students who
          need someone to act. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {loading ? (
          <div className="lg:col-span-2">
            <SkeletonHero />
          </div>
        ) : (
          <HeroCard
            className="lg:col-span-2"
            eyebrow={scope.kind === "all" ? "Whole faculty" : `${scope.department} Department`}
            value={<AnimatedNumber value={stats.totalStudents} />}
            label="active students"
            meta="Registered in the system."
            actions={
              <Button size="sm" className={heroGhostButtonClass} onClick={() => navigate("/admin/students")}>
                <Users className="h-4 w-4" aria-hidden="true" />
                View students
              </Button>
            }
            aside={
              <div className="flex items-center gap-3 lg:flex-col lg:items-end">
                {attendanceRecorded ? (
                  <ProgressRing
                    onHero
                    value={stats.avgAttendance}
                    size={112}
                    strokeWidth={10}
                    threshold={settings.attendanceThreshold}
                    label="Average attendance"
                  />
                ) : (
                  <span className="flex h-[112px] w-[112px] items-center justify-center rounded-full border-[10px] border-[var(--hero-track)] text-2xl font-bold text-foreground">
                    —
                  </span>
                )}
                <p className="text-xs text-[var(--hero-muted)] lg:text-right">
                  {attendanceRecorded
                    ? `Average attendance · ${settings.attendanceThreshold}% needed`
                    : "No lectures recorded yet"}
                </p>
              </div>
            }
            footer={
              <StatStrip
                onHero
                items={[
                  {
                    label: "courses in the catalogue",
                    value: stats.totalCourses,
                    icon: BookOpen,
                    onClick: () => navigate("/admin/courses"),
                  },
                  {
                    label: `running now · ${stats.activeEnrolments} active enrolment${stats.activeEnrolments === 1 ? "" : "s"}`,
                    value: stats.coursesRunning,
                    icon: Calendar,
                    onClick: () => navigate("/admin/enrollment"),
                  },
                  {
                    label: attendanceRecorded ? "average attendance" : "attendance: no lectures yet",
                    value: attendanceRecorded ? `${stats.avgAttendance}%` : "—",
                    icon: TrendingUp,
                    tone: attendanceTone,
                    onClick: () => navigate("/admin/attendance"),
                  },
                ]}
              />
            }
          />
        )}

        {/* The students furthest below the requirement */}
        <SectionCard
          title={`Below ${settings.attendanceThreshold}% attendance`}
          description={alerts.length > 0 ? "The students furthest below the requirement." : undefined}
          actions={
            <Button
              variant="ghost"
              size="sm"
              className="text-primary hover:text-primary/80"
              onClick={() => navigate("/admin/attendance")}
            >
              Manage
              <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          }
          flush
        >
          {loading ? (
            <div className="space-y-2 p-4" aria-hidden="true">
              <div className="skeleton-shimmer h-12 rounded-control bg-muted" />
              <div className="skeleton-shimmer h-12 rounded-control bg-muted" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-success-bg text-success-fg">
                <PartyPopper className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Nobody is below {settings.attendanceThreshold}%.</span>{" "}
                {attendanceRecorded ? "Every student is at or above it." : "No lectures are recorded yet."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {alerts.map((alert, index) => (
                <li
                  key={index}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-colors ${courseRowClass(alert.courseCode)}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-danger-fg" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {alert.studentName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {alert.regNumber} · <CourseCode code={alert.courseCode} /> {alert.courseName}
                      </p>
                    </div>
                  </div>
                  <StatusBadge tone="danger">{alert.percentage}%</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Where an admin goes next, one row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ActionCard
          index={0}
          label="Attendance"
          description="Mark a lecture, or see each student's attendance"
          icon={Calendar}
          tone="info"
          onClick={() => navigate("/admin/attendance")}
        />
        <ActionCard
          index={1}
          label="Results"
          description="Review submitted sheets, enter marks and publish"
          icon={TrendingUp}
          tone="success"
          onClick={() => navigate("/admin/results")}
        />
        <ActionCard
          index={2}
          label="Students"
          description="Search and view student records"
          icon={Users}
          tone="brand"
          onClick={() => navigate("/admin/students")}
        />
        <ActionCard
          index={3}
          label="Courses"
          description="View and manage the course catalogue"
          icon={BookOpen}
          tone="neutral"
          onClick={() => navigate("/admin/courses")}
        />
      </div>

      {/* Attendance by course; for the whole faculty, the departments in a
          second tab of the same card. */}
      {scope.kind === "all" ? (
        <SectionCard
          title="Courses and departments"
          description={
            chartTab === "courses"
              ? "Lowest first — the courses needing attention."
              : "Active students and catalogue courses in each department."
          }
          bodyClassName="space-y-4"
        >
          <PillTabs
            aria-label="Attendance or departments"
            layoutId="admin-dashboard-chart"
            value={chartTab}
            onChange={(v) => setChartTab(v as "courses" | "departments")}
            tabs={[
              { value: "courses", label: "Course attendance" },
              { value: "departments", label: "By department" },
            ]}
          />
          <TabPanel value={chartTab}>
            {chartTab === "courses" ? (
              chart
            ) : (
              <div className="-mx-4 sm:-mx-5">
                <DepartmentBreakdown bare />
              </div>
            )}
          </TabPanel>
        </SectionCard>
      ) : (
        <SectionCard
          title="Course attendance"
          description="Lowest first — the courses needing attention."
        >
          {chart}
        </SectionCard>
      )}

      {/* Recently published */}
      <SectionCard
        title="Recently published results"
        collapsible
        defaultOpen={false}
        storageKey="admin-recent-results"
        summary={
          recentResults.length > 0
            ? `${recentResults.length} latest · ${recentResults.map((r) => r.courseCode).filter((c, i, a) => a.indexOf(c) === i).slice(0, 3).join(", ")}`
            : undefined
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary/80"
            onClick={() => navigate("/admin/results")}
          >
            Manage results
            <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Button>
        }
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={3} height="h-14" />
          </div>
        ) : recentResultsError ? (
          <div className="p-4">
            <ErrorState message={recentResultsError} onRetry={fetchRecentResults} size="inline" />
          </div>
        ) : recentResults.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No published results yet"
            description="Results you publish will appear here as soon as they go live."
            size="inline"
          />
        ) : (
          <ul className="divide-y divide-border/70">
            {recentResults.map((result) => (
              <li
                key={result.id}
                className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors ${courseRowClass(result.courseCode)}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <CheckCircle className="h-4 w-4 flex-shrink-0 text-success-fg" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {result.studentName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {result.indexNumber} · {result.regNumber} ·{" "}
                      <CourseCode code={result.courseCode} /> {result.courseName}
                    </p>
                    {result.publishedAt && (
                      <p className="text-xs text-muted-foreground/80">
                        Published{" "}
                        {new Date(result.publishedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                </div>
                {/* In the grade's own tone, as on the student's Results page;
                    every grade used to be the same brand red. */}
                <StatusBadge tone={gradeTone(result.grade)} className="flex-shrink-0 px-3 text-sm font-bold">
                  {result.grade}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* The faculty website the AI assistant answers from, read nightly;
          only the Super Admin can start a reading. */}
      {scope.kind === "all" && <FacultyWebsiteCard />}
    </div>
  );
}
