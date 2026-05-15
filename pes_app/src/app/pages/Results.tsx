import { useEffect, useState } from "react";
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
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";

interface CourseResult {
  code: string;
  name: string;
  credits: number;
  mid_sem: number | null;
  ca: number | null;
  ese: number | null;
  oa: number | null;
  grade: string | null;
  gpv: number | null;
  contributes_to_gpa: boolean;
}

interface SemesterData {
  semesterKey: string;
  label: string;
  academicYear: string;
  semesterNum: number;
  courses: CourseResult[];
  sgpa: number;
  totalCredits: number;
}

interface GpaChartPoint {
  semester: string;
  gpa: number;
}

interface RadarPoint {
  subject: string;
  current: number;
  previous: number;
}

const getGradeColor = (grade: string | null) => {
  if (!grade) return "bg-gray-100 text-gray-500 border-gray-200";
  if (grade.startsWith("A"))
    return "bg-green-100 text-green-700 border-green-200";
  if (grade.startsWith("B")) return "bg-blue-100 text-blue-700 border-blue-200";
  if (grade.startsWith("C"))
    return "bg-yellow-100 text-yellow-700 border-yellow-200";
  if (grade === "F") return "bg-red-100 text-red-700 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
};

export default function Results() {
  const { student } = useAuth();
  const [semesters, setSemesters] = useState<SemesterData[]>([]);
  const [gpaChart, setGpaChart] = useState<GpaChartPoint[]>([]);
  const [radarData, setRadarData] = useState<RadarPoint[]>([]);
  const [cgpa, setCgpa] = useState<number>(0);
  const [totalCredits, setTotalCredits] = useState<number>(0);
  const [completedCourses, setCompletedCourses] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!student?.id) return;
    fetchResults();
  }, [student?.id]);

  const fetchResults = async () => {
    setLoading(true);

    const { data } = await supabase
      .from("results")
      .select(
        `
        course_id,
        academic_year,
        mid_sem_mark,
        ca_mark,
        ese_mark,
        oa_mark,
        grade,
        gpv,
        is_published,
        courses (
          course_code,
          title,
          credits,
          semester,
          contributes_to_gpa
        )
      `,
      )
      .eq("student_id", student!.id)
      .eq("is_published", true)
      .order("academic_year", { ascending: true });

    if (!data || data.length === 0) {
      setLoading(false);
      return;
    }

    // Group by semester number
    const semesterMap: Record<
      string,
      {
        academicYear: string;
        semNum: number;
        courses: CourseResult[];
      }
    > = {};

    data.forEach((r: any) => {
      const course = r.courses;
      const semNum = course.semester;
      const key = `sem_${semNum}`;

      if (!semesterMap[key]) {
        semesterMap[key] = {
          academicYear: r.academic_year,
          semNum,
          courses: [],
        };
      }

      semesterMap[key].courses.push({
        code: course.course_code,
        name: course.title,
        credits: course.credits,
        mid_sem: r.mid_sem_mark,
        ca: r.ca_mark,
        ese: r.ese_mark,
        oa: r.oa_mark,
        grade: r.grade,
        gpv: r.gpv,
        contributes_to_gpa: course.contributes_to_gpa,
      });
    });

    // Build semester summaries
    const semList: SemesterData[] = Object.entries(semesterMap)
      .sort((a, b) => a[1].semNum - b[1].semNum)
      .map(([key, val]) => {
        const gpaCourses = val.courses.filter(
          (c) => c.contributes_to_gpa && c.gpv !== null,
        );
        const weightedSum = gpaCourses.reduce(
          (sum, c) => sum + (c.gpv ?? 0) * c.credits,
          0,
        );
        const creditSum = gpaCourses.reduce((sum, c) => sum + c.credits, 0);
        const sgpa =
          creditSum > 0 ? Math.round((weightedSum / creditSum) * 100) / 100 : 0;

        return {
          semesterKey: key,
          label: `Semester ${val.semNum}`,
          academicYear: val.academicYear,
          semesterNum: val.semNum,
          courses: val.courses,
          sgpa,
          totalCredits: creditSum,
        };
      });

    setSemesters(semList);

    // CGPA
    const allGpaCourses = semList.flatMap((s) =>
      s.courses.filter((c) => c.contributes_to_gpa && c.gpv !== null),
    );
    const totalWeighted = allGpaCourses.reduce(
      (sum, c) => sum + (c.gpv ?? 0) * c.credits,
      0,
    );
    const totalCr = allGpaCourses.reduce((sum, c) => sum + c.credits, 0);
    const cgpaVal =
      totalCr > 0 ? Math.round((totalWeighted / totalCr) * 100) / 100 : 0;

    setCgpa(cgpaVal);
    setTotalCredits(totalCr);
    setCompletedCourses(data.length);

    // GPA chart
    setGpaChart(
      semList.map((s) => ({
        semester: `Sem ${s.semesterNum}`,
        gpa: s.sgpa,
      })),
    );

    // Radar — compare last two semesters by avg marks
    if (semList.length >= 2) {
      const current = semList[semList.length - 1];
      const previous = semList[semList.length - 2];

      const avgMark = (courses: CourseResult[], field: keyof CourseResult) => {
        const vals = courses
          .map((c) => c[field] as number | null)
          .filter((v) => v !== null) as number[];
        return vals.length > 0
          ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
          : 0;
      };

      setRadarData([
        {
          subject: "Mid Sem",
          current: avgMark(current.courses, "mid_sem"),
          previous: avgMark(previous.courses, "mid_sem"),
        },
        {
          subject: "CA",
          current: avgMark(current.courses, "ca"),
          previous: avgMark(previous.courses, "ca"),
        },
        {
          subject: "ESE",
          current: avgMark(current.courses, "ese"),
          previous: avgMark(previous.courses, "ese"),
        },
        {
          subject: "Overall",
          current: avgMark(current.courses, "oa"),
          previous: avgMark(previous.courses, "oa"),
        },
      ]);
    }

    setLoading(false);
  };

  const lastTwoSems = semesters.slice(-2);
  const cgpaChange =
    lastTwoSems.length === 2
      ? (lastTwoSems[1].sgpa - lastTwoSems[0].sgpa).toFixed(2)
      : null;

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
                    {loading ? "..." : cgpa.toFixed(2)}
                  </h3>
                  {cgpaChange !== null && (
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-green-600" />
                      <p className="text-sm text-green-600 font-medium">
                        {Number(cgpaChange) >= 0 ? "+" : ""}
                        {cgpaChange} from last sem
                      </p>
                    </div>
                  )}
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
                    {loading ? "..." : totalCredits}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Contributing to GPA
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
                    {loading ? "..." : completedCourses}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Across {semesters.length} semesters
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
                <BarChart data={gpaChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="semester" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" domain={[0, 4]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => [value.toFixed(2), "GPA"]}
                  />
                  <Bar dataKey="gpa" fill="#C41E3A" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

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
              {radarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="subject" stroke="#6b7280" />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 50]}
                      stroke="#6b7280"
                    />
                    <Radar
                      name="Current Semester"
                      dataKey="current"
                      stroke="#C41E3A"
                      fill="#C41E3A"
                      fillOpacity={0.6}
                    />
                    <Radar
                      name="Previous Semester"
                      dataKey="previous"
                      stroke="#8B5CF6"
                      fill="#8B5CF6"
                      fillOpacity={0.4}
                    />
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                  Need at least 2 semesters of data
                </div>
              )}
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
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-12 rounded-lg bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : semesters.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No published results yet.
              </p>
            ) : (
              <Tabs defaultValue={semesters[0]?.semesterKey} className="w-full">
                <TabsList
                  className="mb-6 flex flex-wrap gap-1 h-auto"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.min(semesters.length, 4)}, 1fr)`,
                  }}
                >
                  {semesters.map((sem) => (
                    <TabsTrigger key={sem.semesterKey} value={sem.semesterKey}>
                      Sem {sem.semesterNum}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {semesters.map((sem) => (
                  <TabsContent key={sem.semesterKey} value={sem.semesterKey}>
                    <div className="space-y-4">
                      {/* Semester Summary */}
                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
                        <div>
                          <h4 className="font-semibold text-foreground">
                            {sem.label} — {sem.academicYear}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {sem.courses.length} courses completed
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-3xl font-bold text-primary">
                            {sem.sgpa.toFixed(2)}
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
                              <TableHead>Code</TableHead>
                              <TableHead>Course Name</TableHead>
                              <TableHead className="text-center">
                                Credits
                              </TableHead>
                              <TableHead className="text-center">
                                Mid Sem
                              </TableHead>
                              <TableHead className="text-center">CA</TableHead>
                              <TableHead className="text-center">ESE</TableHead>
                              <TableHead className="text-center">
                                Grade
                              </TableHead>
                              <TableHead className="text-center">GPV</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sem.courses.map((course) => (
                              <TableRow key={course.code}>
                                <TableCell className="font-medium text-primary">
                                  {course.code}
                                </TableCell>
                                <TableCell>{course.name}</TableCell>
                                <TableCell className="text-center">
                                  {course.credits}
                                </TableCell>
                                <TableCell className="text-center">
                                  {course.mid_sem ?? "—"}
                                </TableCell>
                                <TableCell className="text-center">
                                  {course.ca ?? "—"}
                                </TableCell>
                                <TableCell className="text-center">
                                  {course.ese ?? "—"}
                                </TableCell>
                                <TableCell className="text-center">
                                  {course.grade ? (
                                    <Badge
                                      className={`${getGradeColor(course.grade)} border`}
                                    >
                                      {course.grade}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-sm">
                                      Pending
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-center font-semibold">
                                  {course.gpv !== null
                                    ? course.gpv.toFixed(1)
                                    : "—"}
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
                            GPA Credits
                          </p>
                          <p className="text-2xl font-bold text-foreground">
                            {sem.totalCredits}
                          </p>
                        </div>
                        <div className="p-4 bg-muted/30 rounded-lg text-center">
                          <p className="text-sm text-muted-foreground mb-1">
                            Semester GPA
                          </p>
                          <p className="text-2xl font-bold text-primary">
                            {sem.sgpa.toFixed(2)}
                          </p>
                        </div>
                        <div className="p-4 bg-muted/30 rounded-lg text-center">
                          <p className="text-sm text-muted-foreground mb-1">
                            Courses
                          </p>
                          <p className="text-2xl font-bold text-foreground">
                            {sem.courses.length}
                          </p>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
