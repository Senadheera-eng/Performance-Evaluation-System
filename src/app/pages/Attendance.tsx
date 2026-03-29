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

// Mock data
const attendanceData = [
  {
    code: "CS301",
    name: "Software Engineering",
    total: 40,
    attended: 34,
    percentage: 85,
    status: "good" as const,
    lastClass: "March 28, 2026",
  },
  {
    code: "CS302",
    name: "Database Management Systems",
    total: 45,
    attended: 41,
    percentage: 92,
    status: "excellent" as const,
    lastClass: "March 27, 2026",
  },
  {
    code: "CS303",
    name: "Computer Networks",
    total: 38,
    attended: 30,
    percentage: 78,
    status: "warning" as const,
    lastClass: "March 29, 2026",
  },
  {
    code: "CS304",
    name: "Web Technologies",
    total: 42,
    attended: 37,
    percentage: 88,
    status: "good" as const,
    lastClass: "March 26, 2026",
  },
  {
    code: "CS305",
    name: "Machine Learning",
    total: 40,
    attended: 38,
    percentage: 95,
    status: "excellent" as const,
    lastClass: "March 29, 2026",
  },
];

const getStatusColor = (status: string) => {
  switch (status) {
    case "excellent":
      return {
        bg: "bg-green-100",
        text: "text-green-700",
        border: "border-green-200",
        badge: "bg-green-100 text-green-700",
      };
    case "good":
      return {
        bg: "bg-blue-100",
        text: "text-blue-700",
        border: "border-blue-200",
        badge: "bg-blue-100 text-blue-700",
      };
    case "warning":
      return {
        bg: "bg-red-100",
        text: "text-red-700",
        border: "border-red-200",
        badge: "bg-red-100 text-red-700",
      };
    default:
      return {
        bg: "bg-gray-100",
        text: "text-gray-700",
        border: "border-gray-200",
        badge: "bg-gray-100 text-gray-700",
      };
  }
};

export default function Attendance() {
  const overallAttendance = Math.round(
    attendanceData.reduce((sum, course) => sum + course.percentage, 0) /
      attendanceData.length,
  );

  const criticalCourses = attendanceData.filter(
    (course) => course.percentage < 80,
  );
  const goodCourses = attendanceData.filter(
    (course) => course.percentage >= 80 && course.percentage < 90,
  );
  const excellentCourses = attendanceData.filter(
    (course) => course.percentage >= 90,
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Attendance Tracker
        </h1>
        <p className="text-muted-foreground">
          Monitor your attendance and stay on track with the 80% requirement.
        </p>
      </motion.div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="border-border">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Overall Attendance
                  </p>
                  <h3 className="text-4xl font-bold text-foreground mb-2">
                    {overallAttendance}%
                  </h3>
                  <p className="text-xs text-green-600 font-medium">
                    Above requirement
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-primary/10">
                  <TrendingUp className="h-6 w-6 text-primary" />
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
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Excellent (≥90%)
                  </p>
                  <h3 className="text-4xl font-bold text-green-600 mb-2">
                    {excellentCourses.length}
                  </h3>
                  <p className="text-xs text-muted-foreground">courses</p>
                </div>
                <div className="p-3 rounded-xl bg-green-100">
                  <CheckCircle className="h-6 w-6 text-green-600" />
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
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Good (80-89%)
                  </p>
                  <h3 className="text-4xl font-bold text-blue-600 mb-2">
                    {goodCourses.length}
                  </h3>
                  <p className="text-xs text-muted-foreground">courses</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-100">
                  <Calendar className="h-6 w-6 text-blue-600" />
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
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Critical (&lt;80%)
                  </p>
                  <h3 className="text-4xl font-bold text-red-600 mb-2">
                    {criticalCourses.length}
                  </h3>
                  <p className="text-xs text-muted-foreground">courses</p>
                </div>
                <div className="p-3 rounded-xl bg-red-100">
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Alerts */}
      {criticalCourses.length > 0 && (
        <div className="space-y-3">
          {criticalCourses.map((course) => (
            <AlertCard
              key={course.code}
              type="error"
              title={`Critical: ${course.code} - ${course.name}`}
              message={`Your attendance is ${course.percentage}%. You need ${
                80 - course.percentage
              }% more to meet the requirement. Missing ${Math.ceil(
                (80 * course.total - 100 * course.attended) / 20,
              )} more classes will make you non-eligible.`}
              action={{
                label: "View Details",
                onClick: () => {},
              }}
            />
          ))}
        </div>
      )}

      {/* Attendance Details */}
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
            <div className="space-y-4">
              {attendanceData.map((course, index) => {
                const colors = getStatusColor(course.status);
                return (
                  <motion.div
                    key={course.code}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                    className={`p-6 rounded-xl border-2 ${colors.border} bg-card hover:shadow-lg transition-shadow`}
                  >
                    <div className="space-y-4">
                      {/* Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
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
                          <div className={`text-3xl font-bold ${colors.text}`}>
                            {course.percentage}%
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {course.attended}/{course.total}
                          </p>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-2">
                        <Progress value={course.percentage} className="h-3" />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Classes attended: {course.attended}</span>
                          <span>Total classes: {course.total}</span>
                        </div>
                      </div>

                      {/* Status Message */}
                      {course.percentage < 80 && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg">
                          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                          <p className="text-sm text-red-900">
                            You can only miss{" "}
                            <span className="font-semibold">
                              {Math.floor(
                                (course.attended - 0.8 * course.total) / 0.8,
                              )}
                            </span>{" "}
                            more classes to maintain 80% attendance.
                          </p>
                        </div>
                      )}

                      {course.percentage >= 90 && (
                        <div className="flex items-start gap-2 p-3 bg-green-50 rounded-lg">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                          <p className="text-sm text-green-900">
                            Excellent attendance! Keep up the good work.
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
