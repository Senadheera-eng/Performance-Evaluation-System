import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Users,
  BookOpen,
  Calendar,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Clock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import {
  CourseAttendanceChart,
  EmptyState,
  ErrorState,
} from "../../components/common";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getAdminScope, describeAdminScope } from "../../../lib/adminScope";
import { getAdminOfferings } from "../../../lib/attendanceRegister";
import { useSettings } from "../../../lib/settings";
import { formatRegNumber } from "../../../lib/format";

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

  const statCards = [
    {
      title: "Total Students",
      value: stats.totalStudents,
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-100",
      change: "Registered in system",
    },
    {
      title: "Total Courses",
      value: stats.totalCourses,
      icon: BookOpen,
      color: "text-primary",
      bg: "bg-primary/10",
      change: "In course catalogue",
    },
    {
      title: "Courses Running Now",
      value: stats.coursesRunning,
      icon: Calendar,
      color: "text-green-600",
      bg: "bg-green-100",
      change: `${stats.activeEnrolments} active enrolment${stats.activeEnrolments === 1 ? "" : "s"}`,
    },
    {
      title: "Avg. Attendance",
      value: `${stats.avgAttendance}%`,
      icon: TrendingUp,
      color: "text-amber-600",
      bg: "bg-amber-100",
      change: "Across all courses",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Admin Dashboard
        </h1>
        <p className="text-muted-foreground text-sm">
          Overview of the Faculty of Engineering — {describeAdminScope(student)}.
        </p>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, index) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
          >
            <Card className="border-border">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      {card.title}
                    </p>
                    <h3 className="text-2xl font-bold text-foreground mb-1">
                      {loading ? "..." : card.value}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {card.change}
                    </p>
                  </div>
                  <div className={`p-2 rounded-xl ${card.bg}`}>
                    <card.icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Attendance Alerts */}
      {alerts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Card className="border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Attendance Alerts
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary"
                  onClick={() => navigate("/admin/attendance")}
                >
                  Manage
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alerts.map((alert, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 rounded-xl bg-destructive/5 border border-destructive/20"
                  >
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {alert.studentName}
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            — {alert.regNumber}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {alert.courseCode} · {alert.courseName}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-destructive/10 text-destructive border-destructive/20">
                      {alert.percentage}%
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <CourseAttendanceChart
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
          />
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  label: "Update Attendance",
                  description: "Mark present/absent for today's lectures",
                  icon: Calendar,
                  color: "bg-blue-100 text-blue-600",
                  path: "/admin/attendance",
                },
                {
                  label: "Publish Results",
                  description: "Enter marks and publish to students",
                  icon: TrendingUp,
                  color: "bg-green-100 text-green-600",
                  path: "/admin/results",
                },
                {
                  label: "View Students",
                  description: "Search and view student records",
                  icon: Users,
                  color: "bg-primary/10 text-primary",
                  path: "/admin/students",
                },
                {
                  label: "Manage Courses",
                  description: "View and manage course catalogue",
                  icon: BookOpen,
                  color: "bg-amber-100 text-amber-600",
                  path: "/admin/courses",
                },
              ].map((action, index) => (
                <button
                  key={index}
                  onClick={() => navigate(action.path)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-left"
                >
                  <div className={`p-2 rounded-lg ${action.color}`}>
                    <action.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {action.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {action.description}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto" />
                </button>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Recent Results */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recently Published Results</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-primary"
                onClick={() => navigate("/admin/results")}
              >
                Manage Results
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-14 rounded-xl bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : recentResultsError ? (
              <ErrorState
                message={recentResultsError}
                onRetry={fetchRecentResults}
                size="inline"
              />
            ) : recentResults.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No published results yet"
                description="Results you publish will appear here as soon as they go live."
                size="inline"
              />
            ) : (
              <div className="space-y-3">
                {recentResults.map((result) => (
                  <div
                    key={result.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-lg bg-green-100 flex-shrink-0">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {result.studentName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {result.indexNumber} · {result.regNumber} ·{" "}
                          {result.courseCode} — {result.courseName}
                        </p>
                        {result.publishedAt && (
                          <p className="text-xs text-muted-foreground/80">
                            Published{" "}
                            {new Date(result.publishedAt).toLocaleDateString(
                              "en-US",
                              { year: "numeric", month: "short", day: "numeric" },
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge className="bg-primary/10 text-primary text-base font-bold px-3 flex-shrink-0">
                      {result.grade}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
