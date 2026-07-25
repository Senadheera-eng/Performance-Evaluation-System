import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Users,
  GraduationCap,
  TrendingUp,
  Calendar,
  ChevronDown,
  ChevronUp,
  Mail,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getAdminScope, describeAdminScope } from "../../../lib/adminScope";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";

interface Student {
  id: string;
  name: string;
  regNumber: string;
  email: string;
  department: string;
  batchYear: number;
  cgpa: number | null;
  totalCredits: number;
  enrolledCourses: number;
  avgAttendance: number;
  hasAttendanceData: boolean;
}

export default function AdminStudents() {
  const { student: currentAdmin } = useAuth();
  const scope = getAdminScope(currentAdmin);
  const [students, setStudents] = useState<Student[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "cgpa" | "attendance">("name");
  const [batchFilter, setBatchFilter] = useState<number | "all">("all");

  useEffect(() => {
    fetchStudents();
  }, []);

  const fetchStudents = async () => {
    setLoading(true);

    const { data: studentData } = await supabase
      .from("students")
      .select("id, name, reg_number, email, department, batch_year")
      .eq("role", "student")
      .eq("status", "active");

    if (!studentData) {
      setLoading(false);
      return;
    }

    // Full academic picture (CGPA, attendance, enrollment count) computed
    // server-side across ALL departments — RLS on results/attendance/
    // enrollments is intentionally scoped per-course-department for raw
    // row access, so aggregating client-side here would only ever see this
    // admin's own department's courses and silently produce a partial,
    // misleading CGPA/attendance figure.
    const { data: statsData } = await supabase.rpc(
      "get_all_students_academic_stats",
    );

    const statsMap: Record<
      string,
      {
        cgpa: number | null;
        credits: number;
        attendance: number;
        attendanceTotal: number;
        enrolled: number;
      }
    > = {};
    statsData?.forEach((row: any) => {
      statsMap[row.student_id] = {
        cgpa: row.cgpa !== null ? Number(row.cgpa) : null,
        credits: row.total_gpa_credits ?? 0,
        attendance: row.avg_attendance ?? 0,
        attendanceTotal: row.attendance_total ?? 0,
        enrolled: row.enrolled_courses ?? 0,
      };
    });

    const studentList: Student[] = studentData.map((s: any) => {
      const stats = statsMap[s.id];

      return {
        id: s.id,
        name: s.name,
        regNumber: formatRegNumber(s.reg_number),
        email: s.email,
        department: s.department,
        batchYear: s.batch_year,
        cgpa: stats?.cgpa ?? null,
        totalCredits: stats?.credits ?? 0,
        enrolledCourses: stats?.enrolled ?? 0,
        avgAttendance: stats?.attendance ?? 0,
        hasAttendanceData: (stats?.attendanceTotal ?? 0) > 0,
      };
    });

    setStudents(studentList);
    setLoading(false);
  };

  const batches = [...new Set(students.map((s) => s.batchYear))].sort(
    (a, b) => b - a,
  );

  const batchFiltered =
    batchFilter === "all"
      ? students
      : students.filter((s) => s.batchYear === batchFilter);

  const filtered = batchFiltered
    .filter(
      (s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.regNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.email.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .sort((a, b) => {
      if (sortBy === "cgpa") return (b.cgpa ?? 0) - (a.cgpa ?? 0);
      if (sortBy === "attendance") return b.avgAttendance - a.avgAttendance;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Student Management
        </h1>
        <p className="text-muted-foreground text-sm">
          {scope.kind === "all"
            ? "View and manage all registered students and their academic records."
            : scope.department === "Interdisciplinary Studies"
              ? "Students with results or enrollments in an Interdisciplinary Studies course."
              : `Students in ${describeAdminScope(currentAdmin)}.`}
        </p>
      </motion.div>

      {/* Batch filter */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
          Batch:
        </label>
        <select
          value={batchFilter}
          onChange={(e) =>
            setBatchFilter(
              e.target.value === "all" ? "all" : Number(e.target.value),
            )
          }
          className="h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="all">All Batches</option>
          {batches.map((b) => (
            <option key={b} value={b}>
              {describeBatch(b)}
            </option>
          ))}
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          {
            label: "Total Students",
            value: batchFiltered.length,
            icon: Users,
            color: "bg-primary/10 text-primary",
          },
          {
            label: "Avg CGPA",
            value:
              batchFiltered.length > 0
                ? (
                    batchFiltered
                      .filter((s) => s.cgpa !== null)
                      .reduce((sum, s) => sum + (s.cgpa ?? 0), 0) /
                    batchFiltered.filter((s) => s.cgpa !== null).length
                  ).toFixed(2)
                : "—",
            icon: TrendingUp,
            color: "bg-green-100 text-green-600",
          },
          {
            label: "Avg Attendance",
            value:
              batchFiltered.filter((s) => s.hasAttendanceData).length > 0
                ? `${Math.round(
                    batchFiltered
                      .filter((s) => s.hasAttendanceData)
                      .reduce((sum, s) => sum + s.avgAttendance, 0) /
                      batchFiltered.filter((s) => s.hasAttendanceData).length,
                  )}%`
                : "—",
            icon: Calendar,
            color: "bg-blue-100 text-blue-600",
          },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: i * 0.1 }}
            className="bg-card rounded-xl p-3 border border-border shadow-sm"
          >
            <div className="flex items-center gap-2.5">
              <div className={`p-1.5 rounded-lg ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">
                  {loading ? "..." : stat.value}
                </p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Search and Sort */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, reg number or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-card border-border"
          />
        </div>
        <div className="flex gap-2">
          {(["name", "cgpa", "attendance"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className="px-3 py-1.5 rounded-xl text-sm font-medium transition-all"
              style={
                sortBy === s
                  ? { backgroundColor: "#C41E3A", color: "white" }
                  : {}
              }
            >
              <span
                className={
                  sortBy === s ? "text-white" : "text-muted-foreground"
                }
              >
                {s === "name" ? "Name" : s === "cgpa" ? "CGPA" : "Attendance"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Student List */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>
            Students{" "}
            <span className="text-muted-foreground font-normal text-sm">
              ({filtered.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-xl bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">No students found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((student, index) => (
                <motion.div
                  key={student.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                >
                  {/* Student Row */}
                  <div
                    className="p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() =>
                      setExpandedId(
                        expandedId === student.id ? null : student.id,
                      )
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                          style={{
                            background:
                              "linear-gradient(135deg, #C41E3A, #6D28D9)",
                          }}
                        >
                          {student.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">
                            {student.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {student.regNumber} · {student.department}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="hidden md:flex items-center gap-6">
                          <div className="text-center">
                            <p className="text-lg font-bold text-primary">
                              {student.cgpa?.toFixed(2) ?? "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              CGPA
                            </p>
                          </div>
                          <div className="text-center">
                            <p
                              className={`text-lg font-bold ${
                                !student.hasAttendanceData
                                  ? "text-muted-foreground"
                                  : student.avgAttendance >= 80
                                    ? "text-green-600"
                                    : "text-red-600"
                              }`}
                            >
                              {student.hasAttendanceData
                                ? `${student.avgAttendance}%`
                                : "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Attendance
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-lg font-bold text-foreground">
                              {student.enrolledCourses}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Enrolled
                            </p>
                          </div>
                        </div>
                        {student.hasAttendanceData &&
                          student.avgAttendance < 80 && (
                            <Badge className="bg-red-100 text-red-700 hidden md:flex">
                              Low Attendance
                            </Badge>
                          )}
                        {expandedId === student.id ? (
                          <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedId === student.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="mx-2 p-3 rounded-b-xl border border-t-0 border-border bg-muted/30"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Email
                            </p>
                            <p className="text-sm font-medium text-foreground">
                              {student.email}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Batch
                            </p>
                            <p className="text-sm font-medium text-foreground">
                              {student.batchYear}/{student.batchYear + 1}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <GraduationCap className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Credits Earned
                            </p>
                            <p className="text-sm font-medium text-foreground">
                              {student.totalCredits}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              CGPA
                            </p>
                            <p className="text-sm font-medium text-primary">
                              {student.cgpa?.toFixed(2) ?? "No results yet"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
