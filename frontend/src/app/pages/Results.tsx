import { motion } from "framer-motion";
import { TrendingUp, Award, FileText, Download } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from "recharts";

// Mock data
const semesterResults = [
  {
    semester: "Semester 1 (2021/22)",
    courses: [
      {
        code: "CS101",
        name: "Introduction to Computing",
        grade: "A",
        gpa: 4.0,
        credits: 3,
      },
      {
        code: "CS102",
        name: "Programming Fundamentals",
        grade: "A-",
        gpa: 3.7,
        credits: 4,
      },
      {
        code: "MA101",
        name: "Mathematics I",
        grade: "B+",
        gpa: 3.3,
        credits: 3,
      },
      {
        code: "EN101",
        name: "English Communication",
        grade: "A",
        gpa: 4.0,
        credits: 2,
      },
    ],
    gpa: 3.75,
    credits: 12,
  },
  {
    semester: "Semester 2 (2021/22)",
    courses: [
      {
        code: "CS201",
        name: "Data Structures",
        grade: "A",
        gpa: 4.0,
        credits: 4,
      },
      { code: "CS202", name: "Algorithms", grade: "A-", gpa: 3.7, credits: 3 },
      {
        code: "CS203",
        name: "Operating Systems",
        grade: "B+",
        gpa: 3.3,
        credits: 4,
      },
      {
        code: "MA201",
        name: "Mathematics II",
        grade: "A-",
        gpa: 3.7,
        credits: 3,
      },
    ],
    gpa: 3.68,
    credits: 14,
  },
];

const gpaData = [
  { semester: "Sem 1", gpa: 3.75 },
  { semester: "Sem 2", gpa: 3.68 },
  { semester: "Sem 3", gpa: 3.82 },
  { semester: "Sem 4", gpa: 3.77 },
  { semester: "Sem 5", gpa: 3.85 },
  { semester: "Sem 6", gpa: 3.92 },
];

const performanceRadar = [
  { subject: "Theory", A: 85, B: 75 },
  { subject: "Practical", A: 90, B: 80 },
  { subject: "Assignments", A: 88, B: 78 },
  { subject: "Presentations", A: 82, B: 72 },
  { subject: "Exams", A: 87, B: 77 },
];

const getGradeColor = (grade: string) => {
  if (grade.startsWith("A"))
    return "bg-green-100 text-green-700 border-green-200";
  if (grade.startsWith("B")) return "bg-blue-100 text-blue-700 border-blue-200";
  if (grade.startsWith("C"))
    return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
};

export default function Results() {
  const currentCGPA = 3.85;
  const totalCredits = 102;
  const completedCourses = 35;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Academic Results
            </h1>
            <p className="text-muted-foreground">
              View your semester-wise results and overall academic performance.
            </p>
          </div>
          <Button className="bg-primary hover:bg-primary/90">
            <Download className="h-4 w-4 mr-2" />
            Download Transcript
          </Button>
        </div>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="border-border relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl" />
            <CardContent className="p-6 relative">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Current CGPA
                  </p>
                  <h3 className="text-5xl font-bold text-primary mb-2">
                    {currentCGPA}
                  </h3>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-600" />
                    <p className="text-sm text-green-600 font-medium">
                      +0.07 from last sem
                    </p>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-primary/10">
                  <Award className="h-6 w-6 text-primary" />
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
                    Credits Earned
                  </p>
                  <h3 className="text-5xl font-bold text-foreground mb-2">
                    {totalCredits}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Out of 120 required
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-blue-100">
                  <FileText className="h-6 w-6 text-blue-600" />
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
                    Courses Completed
                  </p>
                  <h3 className="text-5xl font-bold text-foreground mb-2">
                    {completedCourses}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Across 6 semesters
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-green-100">
                  <Award className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GPA Trend */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>GPA Trend Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={gpaData}>
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
                  <Bar dataKey="gpa" fill="#C41E3A" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Performance Radar */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Performance Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={performanceRadar}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="subject" stroke="#6b7280" />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 100]}
                    stroke="#6b7280"
                  />
                  <Radar
                    name="Current Semester"
                    dataKey="A"
                    stroke="#C41E3A"
                    fill="#C41E3A"
                    fillOpacity={0.6}
                  />
                  <Radar
                    name="Previous Semester"
                    dataKey="B"
                    stroke="#8B5CF6"
                    fill="#8B5CF6"
                    fillOpacity={0.4}
                  />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Semester Results */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Semester-wise Results</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="0" className="w-full">
              <TabsList className="grid grid-cols-2 w-full max-w-md mb-6">
                {semesterResults.map((sem, index) => (
                  <TabsTrigger key={index} value={index.toString()}>
                    {sem.semester.split(" ")[0]} {sem.semester.split(" ")[1]}
                  </TabsTrigger>
                ))}
              </TabsList>

              {semesterResults.map((semester, index) => (
                <TabsContent key={index} value={index.toString()}>
                  <div className="space-y-4">
                    {/* Semester Summary */}
                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
                      <div>
                        <h4 className="font-semibold text-foreground">
                          {semester.semester}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {semester.courses.length} courses completed
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-3xl font-bold text-primary">
                          {semester.gpa.toFixed(2)}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Semester GPA
                        </p>
                      </div>
                    </div>

                    {/* Course Results Table */}
                    <div className="border border-border rounded-xl overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Course Code</TableHead>
                            <TableHead>Course Name</TableHead>
                            <TableHead className="text-center">
                              Credits
                            </TableHead>
                            <TableHead className="text-center">Grade</TableHead>
                            <TableHead className="text-center">GPA</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {semester.courses.map((course) => (
                            <TableRow key={course.code}>
                              <TableCell className="font-medium">
                                {course.code}
                              </TableCell>
                              <TableCell>{course.name}</TableCell>
                              <TableCell className="text-center">
                                {course.credits}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge
                                  className={`${getGradeColor(course.grade)} border`}
                                >
                                  {course.grade}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center font-semibold">
                                {course.gpa.toFixed(1)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Semester Stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-4 bg-muted/30 rounded-lg text-center">
                        <p className="text-sm text-muted-foreground mb-1">
                          Total Credits
                        </p>
                        <p className="text-2xl font-bold text-foreground">
                          {semester.credits}
                        </p>
                      </div>
                      <div className="p-4 bg-muted/30 rounded-lg text-center">
                        <p className="text-sm text-muted-foreground mb-1">
                          Semester GPA
                        </p>
                        <p className="text-2xl font-bold text-primary">
                          {semester.gpa.toFixed(2)}
                        </p>
                      </div>
                      <div className="p-4 bg-muted/30 rounded-lg text-center">
                        <p className="text-sm text-muted-foreground mb-1">
                          Courses
                        </p>
                        <p className="text-2xl font-bold text-foreground">
                          {semester.courses.length}
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
