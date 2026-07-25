import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, AlertTriangle, CheckCircle, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
import { AlertCard } from "../components/dashboard/AlertCard";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../../lib/settings";

interface CourseAttendance {
  id: string;
  code: string;
  name: string;
  total: number;
  attended: number;
  percentage: number;
  status: "excellent" | "good" | "warning" | "pending";
  lastClass: string;
  absencesAllowed: number;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case "excellent":
      return {
        text: "text-green-600",
        border: "border-green-200",
        badge: "bg-green-100 text-green-700",
        messageBg: "bg-green-50",
        messageText: "text-green-900",
        messageIcon: "text-green-600",
      };
    case "good":
      return {
        text: "text-blue-600",
        border: "border-blue-200",
        badge: "bg-blue-100 text-blue-700",
        messageBg: "bg-blue-50",
        messageText: "text-blue-900",
        messageIcon: "text-blue-600",
      };
    case "warning":
      return {
        text: "text-red-600",
        border: "border-red-200",
        badge: "bg-red-100 text-red-700",
        messageBg: "bg-red-50",
        messageText: "text-red-900",
        messageIcon: "text-red-600",
      };
    case "pending":
      return {
        text: "text-gray-500",
        border: "border-gray-200",
        badge: "bg-gray-100 text-gray-600",
        messageBg: "bg-gray-50",
        messageText: "text-gray-700",
        messageIcon: "text-gray-500",
      };
    default:
      return {
        text: "text-gray-600",
        border: "border-gray-200",
        badge: "bg-gray-100 text-gray-700",
        messageBg: "bg-gray-50",
        messageText: "text-gray-900",
        messageIcon: "text-gray-600",
      };
  }
};

const EXCELLENT_MARGIN = 10;

const getStatus = (
  percentage: number,
  total: number,
  threshold: number,
): "excellent" | "good" | "warning" | "pending" => {
  if (total === 0) return "pending";
  if (percentage >= threshold + EXCELLENT_MARGIN) return "excellent";
  if (percentage >= threshold) return "good";
  return "warning";
};

export default function Attendance() {
  const { student } = useAuth();
  const settings = useSettings();
  const threshold = settings.attendanceThreshold;
  const [courses, setCourses] = useState<CourseAttendance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!student?.id) return;
    fetchAttendance();
  }, [student?.id, threshold]);

  const fetchAttendance = async () => {
    setLoading(true);

    // Get current enrolled courses
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("course_id, courses(id, course_code, title)")
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    if (!enrollments || enrollments.length === 0) {
      setLoading(false);
      return;
    }

    const courseIds = enrollments.map((e: any) => e.course_id);

    // Get all attendance records for current courses
    const { data: attRecords } = await supabase
      .from("attendance")
      .select("course_id, status, lecture_date")
      .eq("student_id", student!.id)
      .in("course_id", courseIds)
      .order("lecture_date", { ascending: false });

    if (!attRecords) {
      setLoading(false);
      return;
    }

    // Calculate per-course stats
    const courseMap: Record<
      string,
      {
        present: number;
        total: number;
        lastDate: string;
      }
    > = {};

    attRecords.forEach((r: any) => {
      if (!courseMap[r.course_id]) {
        courseMap[r.course_id] = { present: 0, total: 0, lastDate: "" };
      }
      courseMap[r.course_id].total++;
      if (r.status === "present" || r.status === "excused") {
        courseMap[r.course_id].present++;
      }
      // First record is latest due to order
      if (!courseMap[r.course_id].lastDate) {
        courseMap[r.course_id].lastDate = r.lecture_date;
      }
    });

    // Build final course list
    const result: CourseAttendance[] = enrollments.map((e: any) => {
      const stats = courseMap[e.course_id] ?? {
        present: 0,
        total: 0,
        lastDate: "",
      };
      const percentage =
        stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;

      // How many more absences before dropping below the required threshold.
      const t = threshold / 100;
      const absencesAllowed = Math.max(
        0,
        Math.floor((stats.present - t * stats.total) / t),
      );

      // Format last class date
      const lastClass = stats.lastDate
        ? new Date(stats.lastDate).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "No records";

      return {
        id: e.course_id,
        code: e.courses.course_code,
        name: e.courses.title,
        total: stats.total,
        attended: stats.present,
        percentage,
        status: getStatus(percentage, stats.total, threshold),
        lastClass,
        absencesAllowed,
      };
    });

    // Sort: warning first, then good, then excellent
    result.sort((a, b) => {
      const order = { warning: 0, good: 1, excellent: 2 };
      return order[a.status] - order[b.status];
    });

    setCourses(result);
    setLoading(false);
  };

  // Courses with no recorded lectures yet have nothing to average — including
  // them as 0% would understate attendance for courses that simply haven't
  // had a lecture marked yet.
  const scoredCourses = courses.filter((c) => c.status !== "pending");
  const overallAttendance =
    scoredCourses.length > 0
      ? Math.round(
          scoredCourses.reduce((sum, c) => sum + c.percentage, 0) /
            scoredCourses.length,
        )
      : 0;

  const excellentCourses = courses.filter((c) => c.status === "excellent");
  const goodCourses = courses.filter((c) => c.status === "good");
  const criticalCourses = courses.filter((c) => c.status === "warning");

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Attendance Tracker
        </h1>
        <p className="text-muted-foreground text-sm">
          Monitor your attendance and stay on track with the {threshold}% CCR
          requirement.
        </p>
      </motion.div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Overall Attendance
                  </p>
                  <h3 className="text-2xl font-bold text-foreground mb-1.5">
                    {loading ? "..." : `${overallAttendance}%`}
                  </h3>
                  <p
                    className={`text-xs font-medium ${
                      overallAttendance >= threshold
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {overallAttendance >= threshold
                      ? "Above requirement"
                      : "Below requirement"}
                  </p>
                </div>
                <div className="p-2 rounded-xl bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Excellent (≥{threshold + EXCELLENT_MARGIN}%)
                  </p>
                  <h3 className="text-2xl font-bold text-green-600 mb-1.5">
                    {loading ? "..." : excellentCourses.length}
                  </h3>
                  <p className="text-xs text-muted-foreground">courses</p>
                </div>
                <div className="p-2 rounded-xl bg-green-100">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Good ({threshold}-{threshold + EXCELLENT_MARGIN - 1}%)
                  </p>
                  <h3 className="text-2xl font-bold text-blue-600 mb-1.5">
                    {loading ? "..." : goodCourses.length}
                  </h3>
                  <p className="text-xs text-muted-foreground">courses</p>
                </div>
                <div className="p-2 rounded-xl bg-blue-100">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Critical (&lt;{threshold}%)
                  </p>
                  <h3 className="text-2xl font-bold text-red-600 mb-1.5">
                    {loading ? "..." : criticalCourses.length}
                  </h3>
                  <p className="text-xs text-muted-foreground">courses</p>
                </div>
                <div className="p-2 rounded-xl bg-red-100">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Critical Alerts */}
      {criticalCourses.length > 0 && (
        <div className="space-y-3">
          {criticalCourses.map((course) => {
            const needed = Math.ceil(
              ((threshold / 100) * course.total - course.attended) / (1 - threshold / 100),
            );
            return (
              <AlertCard
                key={course.code}
                type="error"
                title={`Critical: ${course.code} - ${course.name}`}
                message={`Your attendance is ${course.percentage}%. You need to attend ${needed} more lecture(s) without any absence to meet the ${threshold}% CCR requirement.`}
                action={{ label: "View Details", onClick: () => {} }}
              />
            );
          })}
        </div>
      )}

      {/* Detailed Attendance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Detailed Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-32 rounded-xl bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {courses.map((course, index) => {
                  const colors = getStatusColor(course.status);
                  return (
                    <motion.div
                      key={course.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.08 }}
                      className={`p-4 rounded-xl border-2 ${colors.border} bg-card hover:shadow-lg transition-shadow`}
                    >
                      <div className="space-y-3">
                        {/* Header */}
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2.5 mb-1">
                              <h4 className="font-semibold text-foreground">
                                {course.name}
                              </h4>
                              <Badge className={colors.badge}>
                                {course.code}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Last attended: {course.lastClass}
                            </p>
                          </div>
                          <div className="text-right">
                            <div
                              className={`text-2xl font-bold ${colors.text}`}
                            >
                              {course.percentage}%
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {course.attended}/{course.total}
                            </p>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1.5">
                          <Progress value={course.percentage} className="h-2.5" />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Classes attended: {course.attended}</span>
                            <span>Total classes: {course.total}</span>
                          </div>
                        </div>

                        {/* Status Message */}
                        {course.status === "pending" && (
                          <div
                            className={`flex items-start gap-2 p-2.5 rounded-lg ${colors.messageBg}`}
                          >
                            <Calendar
                              className={`h-4 w-4 mt-0.5 ${colors.messageIcon}`}
                            />
                            <p className={`text-sm ${colors.messageText}`}>
                              No lectures have been recorded for this course
                              yet — attendance will appear here once your
                              department admin starts marking it.
                            </p>
                          </div>
                        )}

                        {course.status === "warning" && (
                          <div
                            className={`flex items-start gap-2 p-2.5 rounded-lg ${colors.messageBg}`}
                          >
                            <AlertTriangle
                              className={`h-4 w-4 mt-0.5 ${colors.messageIcon}`}
                            />
                            <p className={`text-sm ${colors.messageText}`}>
                              You are below the {threshold}% CCR threshold. You cannot
                              afford any more absences — attend all remaining
                              lectures to avoid becoming non-eligible.
                            </p>
                          </div>
                        )}

                        {course.status === "good" && (
                          <div
                            className={`flex items-start gap-2 p-2.5 rounded-lg ${colors.messageBg}`}
                          >
                            <Calendar
                              className={`h-4 w-4 mt-0.5 ${colors.messageIcon}`}
                            />
                            <p className={`text-sm ${colors.messageText}`}>
                              You can afford{" "}
                              <span className="font-semibold">
                                {course.absencesAllowed} more absence
                                {course.absencesAllowed !== 1 ? "s" : ""}
                              </span>{" "}
                              before dropping below {threshold}%.
                            </p>
                          </div>
                        )}

                        {course.status === "excellent" && (
                          <div
                            className={`flex items-start gap-2 p-2.5 rounded-lg ${colors.messageBg}`}
                          >
                            <CheckCircle
                              className={`h-4 w-4 mt-0.5 ${colors.messageIcon}`}
                            />
                            <p className={`text-sm ${colors.messageText}`}>
                              Excellent attendance! You can afford{" "}
                              <span className="font-semibold">
                                {course.absencesAllowed} more absence
                                {course.absencesAllowed !== 1 ? "s" : ""}
                              </span>{" "}
                              while staying above {threshold}%.
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
