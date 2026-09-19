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
import { InsightsPanel } from "../components/dashboard/InsightsPanel";
import { LatestNotices } from "../components/dashboard/LatestNotices";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  GpaTrendChart,
  CourseAttendanceChart,
} from "../components/common";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../../lib/settings";

interface CourseWithAttendance {
  id: string;
  code: string;
  name: string;
  credits: number;
  status: "ongoing" | "completed" | "upcoming";
  attendance: number;
  progress: number;
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
  const settings = useSettings();
  const threshold = settings.attendanceThreshold;

  const [cgpa, setCgpa] = useState<number | null>(null);
  const [totalCredits, setTotalCredits] = useState(0);
  const [enrolledCount, setEnrolledCount] = useState(0);
  /* Null, not zero, until a lecture has actually been recorded. Nought per
     cent is a real and alarming reading; "nothing marked yet" is not, and the
     card was showing the first when it meant the second. */
  const [avgAttendance, setAvgAttendance] = useState<number | null>(null);
  const [ongoingCourses, setOngoingCourses] = useState<CourseWithAttendance[]>(
    [],
  );
  const [attendanceData, setAttendanceData] = useState<
    { course: string; attendance: number }[]
  >([]);
  const [awaitingAttendance, setAwaitingAttendance] = useState(0);
  const [semesterData, setSemesterData] = useState<SemesterGPA[]>([]);
  const [recentResults, setRecentResults] = useState<RecentResult[]>([]);
  const [loading, setLoading] = useState(true);

  const firstName = student?.name?.split(" ")[0] ?? "Student";

  useEffect(() => {
    if (!student?.id) return;
    fetchDashboardData();
  }, [student?.id, threshold]);

  const fetchDashboardData = async () => {
    setLoading(true);
    /* The enrolment list is read once and handed to both the count and the
       attendance breakdown. They used to fetch it separately — same student,
       same filter, different columns — which cost two round trips for one
       answer that cannot disagree with itself. */
    const enrolled = await fetchEnrollments();
    await Promise.all([
      fetchGPAData(),
      fetchAttendance(enrolled),
      fetchRecentResults(),
    ]);
    setLoading(false);
  };

  const fetchGPAData = async () => {
    // Fetch all published results with course credits
    // Student-facing reads go through `my_published_results`, which
    // self-scopes to the caller and withholds ese_mark/oa_mark.
    const { data } = await supabase
      .from("my_published_results")
      .select("gpv, academic_year, course_id, semester, credits, contributes_to_gpa")
      .not("gpv", "is", null);

    if (!data || data.length === 0) return;

    // Calculate CGPA
    let totalWeighted = 0;
    let totalCredits = 0;
    const semesterMap: Record<string, { weighted: number; credits: number }> =
      {};

    data.forEach((r: any) => {
      if (!r.contributes_to_gpa) return;

      totalWeighted += r.gpv * r.credits;
      totalCredits += r.credits;

      const semKey = `Sem ${r.semester}`;
      if (!semesterMap[semKey])
        semesterMap[semKey] = { weighted: 0, credits: 0 };
      semesterMap[semKey].weighted += r.gpv * r.credits;
      semesterMap[semKey].credits += r.credits;
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
      .select("course_id, status, courses(id, course_code, title, credits, semester)")
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    if (!data) return [];
    setEnrolledCount(data.length);
    return data;
  };

  const fetchAttendance = async (enrollments: any[]) => {
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
    /* compliant = present + excused. An excused absence counts in the
       student's favour everywhere else in the system, so it counts here too;
       the field used to be called "present", which read like it did not. */
    const courseAttMap: Record<string, { compliant: number; total: number }> = {};
    attData.forEach((a: any) => {
      if (!courseAttMap[a.course_id])
        courseAttMap[a.course_id] = { compliant: 0, total: 0 };
      courseAttMap[a.course_id].total++;
      if (a.status === "present" || a.status === "excused")
        courseAttMap[a.course_id].compliant++;
    });

    // Continuous-assessment progress on ongoing courses. Only published rows
    // are readable — an unpublished draft is the lecturer's working copy and
    // was never actually reachable here, so this query returned nothing even
    // before the switch to the view.
    const { data: resultsData } = await supabase
      .from("my_published_results")
      .select("course_id, mid_sem_mark, ca_mark");

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
      const percentage = att ? Math.round((att.compliant / att.total) * 100) : 0;
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

    // Average attendance — only over courses that actually have a lecture
    // recorded yet. A freshly enrolled course with zero lectures marked has
    // nothing to average and shouldn't be treated as 0%.
    const scoredCourses = courses.filter((c) => (courseAttMap[c.id]?.total ?? 0) > 0);

    // The chart follows the same rule the average already did. Plotting every
    // enrolled course meant courses with no lectures yet drew as flat 0% bars
    // beside the one course that had data.
    setAttendanceData(
      scoredCourses.map((c) => ({ course: c.code, attendance: c.attendance })),
    );
    setAwaitingAttendance(courses.length - scoredCourses.length);

    setAvgAttendance(
      scoredCourses.length > 0
        ? Math.round(
            scoredCourses.reduce((sum, c) => sum + c.attendance, 0) /
              scoredCourses.length,
          )
        : null,
    );

  };

  const fetchRecentResults = async () => {
    const { data } = await supabase
      .from("my_published_results")
      .select("grade, gpv, course_title, course_code, published_at")
      .not("grade", "is", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(5);

    if (!data) return;

    setRecentResults(
      data.map((r: any) => ({
        course: r.course_title,
        code: r.course_code,
        grade: r.grade,
        gpv: r.gpv,
      })),
    );
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Welcome Back, {firstName}! 👋
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm">
            Here's what's happening with your academic progress today.
          </p>
          {student?.department && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <GraduationCap className="h-3.5 w-3.5" />
              {student.department}
            </span>
          )}
        </div>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
          value={loading ? "..." : avgAttendance === null ? "—" : `${avgAttendance}%`}
          /* Saying "below the required 80%" to a student whose lectures have
             simply not been marked yet is a warning about nothing, and it is
             the first thing they read on the page. */
          change={
            avgAttendance === null
              ? "No lectures recorded yet"
              : avgAttendance >= threshold
                ? `Above required ${threshold}%`
                : `Below required ${threshold}%`
          }
          changeType={
            avgAttendance === null
              ? "neutral"
              : avgAttendance >= threshold
                ? "positive"
                : "negative"
          }
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

      {/* What the system noticed without being asked — attendance slipping, a
          semester GPA falling, a medical certificate or enrolment window
          about to close. This used to be an attendance-only list worked out
          here in the browser; the rules now live in get_my_insights() so the
          AI assistant reads exactly the same ones. */}
      <InsightsPanel />

      <LatestNotices />

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <GpaTrendChart
          data={semesterData}
          cgpa={cgpa ?? 0}
          loading={loading}
          height={240}
        />
        <CourseAttendanceChart
          title="Attendance by course"
          data={attendanceData.map((a) => ({
            code: a.course,
            percentage: a.attendance,
          }))}
          threshold={threshold}
          prewarning={settings.attendancePrewarningThreshold}
          awaitingCount={awaitingAttendance}
          loading={loading}
        />
      </div>

      {/* Ongoing Courses */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-foreground">
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
