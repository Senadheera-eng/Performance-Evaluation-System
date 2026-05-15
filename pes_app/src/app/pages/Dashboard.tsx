import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Calendar,
  TrendingUp,
  Award,
  ArrowRight,
} from "lucide-react";
import { StatCard } from "../components/dashboard/StatCard";
import { CourseCard } from "../components/dashboard/CourseCard";
import { AlertCard } from "../components/dashboard/AlertCard";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";

interface CourseWithAttendance {
  id: string;
  code: string;
  name: string;
  credits: number;
  status: "ongoing" | "completed" | "upcoming";
  attendance: number;
  progress: number;
}

interface AttendanceAlert {
  courseCode: string;
  courseName: string;
  percentage: number;
  totalLectures: number;
  presentCount: number;
}

interface SemesterGPA {
  semester: string;
  gpa: number;
}

interface RecentResult {
  course: string;
  code: string;
  grade: string;
  gpv: number;
}

export default function Dashboard() {
  const { student } = useAuth();
  const navigate = useNavigate();

  const [cgpa, setCgpa] = useState<number | null>(null);
  const [totalCredits, setTotalCredits] = useState(0);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [avgAttendance, setAvgAttendance] = useState(0);
  const [ongoingCourses, setOngoingCourses] = useState<CourseWithAttendance[]>(
    [],
  );
  const [attendanceData, setAttendanceData] = useState<
    { course: string; attendance: number }[]
  >([]);
  const [semesterData, setSemesterData] = useState<SemesterGPA[]>([]);
  const [recentResults, setRecentResults] = useState<RecentResult[]>([]);
  const [alerts, setAlerts] = useState<AttendanceAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const firstName = student?.name?.split(" ")[0] ?? "Student";

  useEffect(() => {
    if (!student?.id) return;
    fetchDashboardData();
  }, [student?.id]);

  const fetchDashboardData = async () => {
    setLoading(true);
    await Promise.all([
      fetchGPAData(),
      fetchEnrollments(),
      fetchAttendance(),
      fetchRecentResults(),
    ]);
    setLoading(false);
  };

  const fetchGPAData = async () => {
    // Fetch all published results with course credits
    const { data } = await supabase
      .from("results")
      .select(
        "gpv, academic_year, course_id, courses(semester, credits, contributes_to_gpa)",
      )
      .eq("student_id", student!.id)
      .eq("is_published", true)
      .not("gpv", "is", null);

    if (!data || data.length === 0) return;

    // Calculate CGPA
    let totalWeighted = 0;
    let totalCredits = 0;
    const semesterMap: Record<string, { weighted: number; credits: number }> =
      {};

    data.forEach((r: any) => {
      const course = r.courses;
      if (!course?.contributes_to_gpa || !r.gpv) return;

      totalWeighted += r.gpv * course.credits;
      totalCredits += course.credits;

      const semKey = `Sem ${course.semester}`;
      if (!semesterMap[semKey])
        semesterMap[semKey] = { weighted: 0, credits: 0 };
      semesterMap[semKey].weighted += r.gpv * course.credits;
      semesterMap[semKey].credits += course.credits;
    });

    const cgpaVal = totalCredits > 0 ? totalWeighted / totalCredits : 0;
    setCgpa(Math.round(cgpaVal * 100) / 100);
    setTotalCredits(totalCredits);

    // Build semester GPA chart data
    const semData = Object.entries(semesterMap)
      .sort((a, b) => {
        const numA = parseInt(a[0].replace("Sem ", ""));
        const numB = parseInt(b[0].replace("Sem ", ""));
        return numA - numB;
      })
      .map(([sem, val]) => ({
        semester: sem,
        gpa: Math.round((val.weighted / val.credits) * 100) / 100,
      }));

    setSemesterData(semData);
  };

  const fetchEnrollments = async () => {
    const { data } = await supabase
      .from("enrollments")
      .select("status, courses(id, course_code, title, credits, semester)")
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    if (!data) return;
    setEnrolledCount(data.length);
  };

  const fetchAttendance = async () => {
    // Get current enrolled courses
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("course_id, courses(course_code, title, credits)")
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    if (!enrollments || enrollments.length === 0) return;

    const courseIds = enrollments.map((e: any) => e.course_id);

    // Get attendance for all current courses
    const { data: attData } = await supabase
      .from("attendance")
      .select("course_id, status")
      .eq("student_id", student!.id)
      .in("course_id", courseIds);

    if (!attData) return;

    // Calculate per-course attendance
    const courseAttMap: Record<string, { present: number; total: number }> = {};
    attData.forEach((a: any) => {
      if (!courseAttMap[a.course_id])
        courseAttMap[a.course_id] = { present: 0, total: 0 };
      courseAttMap[a.course_id].total++;
      if (a.status === "present" || a.status === "excused")
        courseAttMap[a.course_id].present++;
    });

    // Get mid-sem progress from results
    const { data: resultsData } = await supabase
      .from("results")
      .select("course_id, mid_sem_mark, ca_mark")
      .eq("student_id", student!.id)
      .eq("is_published", false);

    const progressMap: Record<string, number> = {};
    resultsData?.forEach((r: any) => {
      if (r.mid_sem_mark && r.ca_mark) {
        progressMap[r.course_id] = Math.round(
          ((r.mid_sem_mark + r.ca_mark) / 90) * 100,
        );
      }
    });

    // Build ongoing courses list
    const courses: CourseWithAttendance[] = enrollments.map((e: any) => {
      const att = courseAttMap[e.course_id];
      const percentage = att ? Math.round((att.present / att.total) * 100) : 0;
      return {
        id: e.course_id,
        code: e.courses.course_code,
        name: e.courses.title,
        credits: e.courses.credits,
        status: "ongoing" as const,
        attendance: percentage,
        progress: progressMap[e.course_id] ?? 50,
      };
    });

    setOngoingCourses(courses);

    // Attendance chart data
    setAttendanceData(
      courses.map((c) => ({ course: c.code, attendance: c.attendance })),
    );

    // Average attendance
    const avg =
      courses.length > 0
        ? Math.round(
            courses.reduce((sum, c) => sum + c.attendance, 0) / courses.length,
          )
        : 0;
    setAvgAttendance(avg);

    // Alerts for courses below 80%
    const alertList: AttendanceAlert[] = courses
      .filter((c) => c.attendance < 80)
      .map((c) => {
        const att = courseAttMap[c.id];
        return {
          courseCode: c.code,
          courseName: c.name,
          percentage: c.attendance,
          totalLectures: att?.total ?? 0,
          presentCount: att?.present ?? 0,
        };
      });
    setAlerts(alertList);
  };

  const fetchRecentResults = async () => {
    const { data } = await supabase
      .from("results")
      .select("grade, gpv, courses(title, course_code)")
      .eq("student_id", student!.id)
      .eq("is_published", true)
      .not("grade", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    if (!data) return;

    setRecentResults(
      data.map((r: any) => ({
        course: r.courses.title,
        code: r.courses.course_code,
        grade: r.grade,
        gpv: r.gpv,
      })),
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Welcome Back, {firstName}! 👋
        </h1>
        <p className="text-muted-foreground">
          Here's what's happening with your academic progress today.
        </p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Current CGPA"
          value={loading ? "..." : (cgpa?.toFixed(2) ?? "N/A")}
          change="Cumulative GPA"
          changeType="positive"
          icon={TrendingUp}
          iconColor="text-primary"
          iconBgColor="bg-primary/10"
        />
        <StatCard
          title="Courses Enrolled"
          value={loading ? "..." : enrolledCount.toString()}
          change="Current semester"
          changeType="neutral"
          icon={GraduationCap}
          iconColor="text-blue-600"
          iconBgColor="bg-blue-100"
        />
        <StatCard
          title="Avg. Attendance"
          value={loading ? "..." : `${avgAttendance}%`}
          change={
            avgAttendance >= 80 ? "Above required 80%" : "Below required 80%"
          }
          changeType={avgAttendance >= 80 ? "positive" : "negative"}
          icon={Calendar}
          iconColor="text-green-600"
          iconBgColor="bg-green-100"
        />
        <StatCard
          title="Credits Completed"
          value={loading ? "..." : totalCredits.toString()}
          change="Contributing to GPA"
          changeType="neutral"
          icon={Award}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
        />
      </div>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const needed =
              Math.ceil(alert.totalLectures * 0.8) - alert.presentCount;
            return (
              <AlertCard
                key={alert.courseCode}
                type="warning"
                title={`Low Attendance — ${alert.courseCode} ${alert.courseName}`}
                message={`Your attendance is ${alert.percentage}%. You need ${needed} more presence(s) to meet the 80% CCR requirement.`}
                action={{
                  label: "View Attendance",
                  onClick: () => navigate("/app/attendance"),
                }}
              />
            );
          })}
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GPA Trend */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>GPA Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={semesterData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="semester" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" domain={[0, 4]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="gpa"
                    stroke="#C41E3A"
                    strokeWidth={3}
                    dot={{ fill: "#C41E3A", r: 5 }}
                    activeDot={{ r: 7 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Attendance Overview */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Attendance Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={attendanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="course" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar
                    dataKey="attendance"
                    fill="#C41E3A"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Ongoing Courses */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-foreground">
            Ongoing Courses
          </h2>
          <Button
            variant="ghost"
            className="text-primary hover:text-primary/80"
            onClick={() => navigate("/app/courses")}
          >
            View All
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
        {loading ? (
          <div className="text-muted-foreground text-sm">
            Loading courses...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ongoingCourses.slice(0, 3).map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                onClick={() => navigate("/app/courses")}
              />
            ))}
          </div>
        )}
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
              <CardTitle>Recent Results</CardTitle>
              <Button
                variant="ghost"
                className="text-primary hover:text-primary/80"
                onClick={() => navigate("/app/results")}
              >
                View All
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-muted-foreground text-sm">
                Loading results...
              </div>
            ) : (
              <div className="space-y-4">
                {recentResults.map((result, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div>
                      <h4 className="font-semibold text-foreground">
                        {result.course}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {result.code}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">
                        {result.grade}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        GPV: {result.gpv}
                      </p>
                    </div>
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
