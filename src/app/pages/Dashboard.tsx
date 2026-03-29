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

// Mock data
const semesterData = [
  { semester: "Sem 1", gpa: 3.2 },
  { semester: "Sem 2", gpa: 3.4 },
  { semester: "Sem 3", gpa: 3.6 },
  { semester: "Sem 4", gpa: 3.7 },
  { semester: "Sem 5", gpa: 3.8 },
  { semester: "Sem 6", gpa: 3.9 },
];

const attendanceData = [
  { course: "CS301", attendance: 85 },
  { course: "CS302", attendance: 92 },
  { course: "CS303", attendance: 78 },
  { course: "CS304", attendance: 88 },
  { course: "CS305", attendance: 95 },
];

const ongoingCourses = [
  {
    id: "1",
    code: "CS301",
    name: "Software Engineering",
    credits: 3,
    status: "ongoing" as const,
    attendance: 85,
    progress: 65,
  },
  {
    id: "2",
    code: "CS302",
    name: "Database Management Systems",
    credits: 4,
    status: "ongoing" as const,
    attendance: 92,
    progress: 70,
  },
  {
    id: "3",
    code: "CS303",
    name: "Computer Networks",
    credits: 3,
    status: "ongoing" as const,
    attendance: 78,
    progress: 55,
  },
];

const recentResults = [
  { course: "Data Structures", code: "CS201", grade: "A", gpa: 4.0 },
  { course: "Algorithms", code: "CS202", grade: "A-", gpa: 3.7 },
  { course: "Operating Systems", code: "CS203", grade: "B+", gpa: 3.3 },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Welcome Back, John! 👋
        </h1>
        <p className="text-muted-foreground">
          Here's what's happening with your academic progress today.
        </p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Current CGPA"
          value="3.85"
          change="+0.05 from last semester"
          changeType="positive"
          icon={TrendingUp}
          iconColor="text-primary"
          iconBgColor="bg-primary/10"
        />
        <StatCard
          title="Courses Enrolled"
          value="5"
          change="Current semester"
          changeType="neutral"
          icon={GraduationCap}
          iconColor="text-blue-600"
          iconBgColor="bg-blue-100"
        />
        <StatCard
          title="Avg. Attendance"
          value="87%"
          change="Above required 80%"
          changeType="positive"
          icon={Calendar}
          iconColor="text-green-600"
          iconBgColor="bg-green-100"
        />
        <StatCard
          title="Total Credits"
          value="102"
          change="Out of 120 required"
          changeType="neutral"
          icon={Award}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
        />
      </div>

      {/* Alerts Section */}
      <div className="space-y-3">
        <AlertCard
          type="warning"
          title="Low Attendance Alert"
          message="Your attendance for CS303 (Computer Networks) is 78%. You need 2% more to meet the 80% requirement."
          action={{
            label: "View Details",
            onClick: () => {},
          }}
        />
        <AlertCard
          type="info"
          title="Upcoming Exam"
          message="Mid-semester examination for CS301 (Software Engineering) is scheduled for April 15, 2026."
          action={{
            label: "View Schedule",
            onClick: () => {},
          }}
        />
      </div>

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
                    fill="#8B5CF6"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Ongoing Courses Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-foreground">
            Ongoing Courses
          </h2>
          <Button
            variant="ghost"
            className="text-primary hover:text-primary/80"
          >
            View All
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {ongoingCourses.map((course) => (
            <CourseCard key={course.id} course={course} onClick={() => {}} />
          ))}
        </div>
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
              >
                View All
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
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
                      GPA: {result.gpa}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
