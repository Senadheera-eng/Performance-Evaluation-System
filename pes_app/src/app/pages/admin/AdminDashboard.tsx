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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "../../../lib/supabase";

interface DashboardStats {
  totalStudents: number;
  totalCourses: number;
  activeCourses: number;
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
  studentName: string;
  courseCode: string;
  courseName: string;
  grade: string;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    totalCourses: 0,
    activeCourses: 0,
    avgAttendance: 0,
  });
  const [alerts, setAlerts] = useState<AttendanceAlert[]>([]);
  const [courseAttendance, setCourseAttendance] = useState<
    CourseAttendanceStat[]
  >([]);
  const [recentResults, setRecentResults] = useState<RecentResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    await Promise.all([
      fetchStats(),
      fetchAttendanceAlerts(),
      fetchCourseAttendance(),
      fetchRecentResults(),
    ]);
    setLoading(false);
  };

  const fetchStats = async () => {
    // Total students
    const { count: studentCount } = await supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("role", "student")
      .eq("status", "active");

    // Total courses
    const { count: courseCount } = await supabase
      .from("courses")
      .select("*", { count: "exact", head: true });

    // Active courses (semester 5 — current)
    const { count: activeCount } = await supabase
      .from("enrollments")
      .select("course_id", { count: "exact", head: true })
      .eq("status", "enrolled");

    // Avg attendance across all current enrollments
    const { data: attData } = await supabase
      .from("attendance")
      .select("status");

    let avgAtt = 0;
    if (attData && attData.length > 0) {
      const present = attData.filter(
        (a: any) => a.status === "present" || a.status === "excused",
      ).length;
      avgAtt = Math.round((present / attData.length) * 100);
    }

    setStats({
      totalStudents: studentCount ?? 0,
      totalCourses: courseCount ?? 0,
      activeCourses: activeCount ?? 0,
      avgAttendance: avgAtt,
    });
  };

  const fetchAttendanceAlerts = async () => {
    // Get all enrolled students and their attendance
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select(
        `
        student_id,
        course_id,
        students (name, reg_number),
        courses (course_code, title)
      `,
      )
      .eq("status", "enrolled");

    if (!enrollments) return;

    const { data: attData } = await supabase
      .from("attendance")
      .select("student_id, course_id, status");

    if (!attData) return;

    // Calculate attendance per student per course
    const attMap: Record<string, { present: number; total: number }> = {};
    attData.forEach((a: any) => {
      const key = `${a.student_id}_${a.course_id}`;
      if (!attMap[key]) attMap[key] = { present: 0, total: 0 };
      attMap[key].total++;
      if (a.status === "present" || a.status === "excused")
        attMap[key].present++;
    });

    // Find students below 80%
    const alertList: AttendanceAlert[] = [];
    enrollments.forEach((e: any) => {
      const key = `${e.student_id}_${e.course_id}`;
      const att = attMap[key];
      if (!att || att.total === 0) return;
      const pct = Math.round((att.present / att.total) * 100);
      if (pct < 80) {
        alertList.push({
          studentName: e.students?.name ?? "—",
          regNumber: e.students?.reg_number ?? "—",
          courseCode: e.courses?.course_code ?? "—",
          courseName: e.courses?.title ?? "—",
          percentage: pct,
        });
      }
    });

    // Sort by lowest attendance first
    alertList.sort((a, b) => a.percentage - b.percentage);
    setAlerts(alertList.slice(0, 5));
  };

  const fetchCourseAttendance = async () => {
    const { data: courses } = await supabase
      .from("courses")
      .select("id, course_code")
      .eq("semester", 5)
      .eq("year", 3);

    if (!courses) return;

    const { data: attData } = await supabase
      .from("attendance")
      .select("course_id, status")
      .in(
        "course_id",
        courses.map((c) => c.id),
      );

    if (!attData) return;

    const courseMap: Record<string, { present: number; total: number }> = {};
    attData.forEach((a: any) => {
      if (!courseMap[a.course_id])
        courseMap[a.course_id] = { present: 0, total: 0 };
      courseMap[a.course_id].total++;
      if (a.status === "present" || a.status === "excused")
        courseMap[a.course_id].present++;
    });

    const stats: CourseAttendanceStat[] = courses
      .map((c) => {
        const att = courseMap[c.id];
        return {
          code: c.course_code,
          avgAttendance: att ? Math.round((att.present / att.total) * 100) : 0,
        };
      })
      .filter((c) => c.avgAttendance > 0);

    setCourseAttendance(stats);
  };

  const fetchRecentResults = async () => {
    const { data } = await supabase
      .from("results")
      .select(
        `
        grade,
        students (name),
        courses (course_code, title)
      `,
      )
      .eq("is_published", true)
      .not("grade", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    if (!data) return;

    setRecentResults(
      data.map((r: any) => ({
        studentName: r.students?.name ?? "—",
        courseCode: r.courses?.course_code ?? "—",
        courseName: r.courses?.title ?? "—",
        grade: r.grade,
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
      title: "Active Enrollments",
      value: stats.activeCourses,
      icon: Calendar,
      color: "text-green-600",
      bg: "bg-green-100",
      change: "Current semester",
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
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Admin Dashboard
        </h1>
        <p className="text-muted-foreground">
          Overview of the Faculty of Engineering — Computer Engineering
          Department.
        </p>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, index) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
          >
            <Card className="border-border">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      {card.title}
                    </p>
                    <h3 className="text-4xl font-bold text-foreground mb-1">
                      {loading ? "..." : card.value}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {card.change}
                    </p>
                  </div>
                  <div className={`p-3 rounded-xl ${card.bg}`}>
                    <card.icon className={`h-6 w-6 ${card.color}`} />
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Course Attendance Overview</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-[300px] bg-muted animate-pulse rounded-lg" />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={courseAttendance}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="code"
                      stroke="#6b7280"
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis stroke="#6b7280" domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number) => [`${value}%`, "Attendance"]}
                    />
                    <Bar
                      dataKey="avgAttendance"
                      fill="#C41E3A"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
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
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-left"
                >
                  <div className={`p-2 rounded-lg ${action.color}`}>
                    <action.icon className="h-5 w-5" />
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
            ) : recentResults.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-muted-foreground text-sm">
                  No published results yet
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentResults.map((result, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-100">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {result.studentName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {result.courseCode} · {result.courseName}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-primary/10 text-primary text-base font-bold px-3">
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
