import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  CheckCircle,
  XCircle,
  Search,
  Save,
  Users,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { EmptyState, PageHeader } from "../../components/common";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getAdminScope } from "../../../lib/adminScope";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";

interface Course {
  id: string;
  code: string;
  name: string;
  semester: number;
}

interface StudentAttendance {
  studentId: string;
  name: string;
  regNumber: string;
  status: "present" | "absent" | "excused" | null;
  existingRecordId: string | null;
}

export default function AdminAttendance() {
  const { student } = useAuth();
  const scope = getAdminScope(student);
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<number[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [batchSemester, setBatchSemester] = useState<number | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [students, setStudents] = useState<StudentAttendance[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [courseDropdownOpen, setCourseDropdownOpen] = useState(false);

  useEffect(() => {
    if (student) {
      fetchCourses();
      fetchBatches();
    }
  }, [student]);

  useEffect(() => {
    if (selectedBatch !== null) fetchBatchCurrentSemester(selectedBatch);
    setSelectedCourse(null);
  }, [selectedBatch]);

  useEffect(() => {
    if (selectedCourse && selectedDate) {
      fetchStudentsForCourse();
    }
  }, [selectedCourse, selectedDate]);

  const fetchCourses = async () => {
    let courseQuery = supabase
      .from("courses")
      .select("id, course_code, title, semester")
      .order("semester")
      .order("course_code");
    if (scope.kind === "department") {
      courseQuery = courseQuery.eq("department", scope.department);
    }
    const { data } = await courseQuery;

    if (data) {
      setAllCourses(
        data.map((c: any) => ({
          id: c.id,
          code: c.course_code,
          name: c.title,
          semester: c.semester,
        })),
      );
    }
  };

  const fetchBatches = async () => {
    const { data } = await supabase
      .from("students")
      .select("batch_year")
      .eq("role", "student");

    const distinct = [...new Set((data ?? []).map((s: any) => s.batch_year))]
      .filter((y): y is number => y !== null)
      .sort((a, b) => b - a);
    setBatches(distinct);
  };

  // A batch's currently ongoing semester is derived from what its students
  // are actively enrolled in right now — not hardcoded — so this keeps
  // working as batches progress year to year.
  const fetchBatchCurrentSemester = async (batchYear: number) => {
    setBatchLoading(true);
    setBatchSemester(null);

    const { data } = await supabase
      .from("enrollments")
      .select("status, students!inner(batch_year), courses!inner(semester)")
      .eq("status", "enrolled")
      .eq("students.batch_year", batchYear);

    const semesterCounts: Record<number, number> = {};
    (data ?? []).forEach((row: any) => {
      const sem = row.courses?.semester;
      if (sem) semesterCounts[sem] = (semesterCounts[sem] ?? 0) + 1;
    });

    const entries = Object.entries(semesterCounts);
    const mostCommonSemester =
      entries.length > 0
        ? Number(entries.sort((a, b) => b[1] - a[1])[0][0])
        : null;

    setBatchSemester(mostCommonSemester);
    setBatchLoading(false);
  };

  const courses =
    selectedBatch === null
      ? []
      : batchSemester === null
        ? []
        : allCourses.filter((c) => c.semester === batchSemester);

  const fetchStudentsForCourse = async () => {
    if (!selectedCourse) return;
    setLoading(true);

    // SECURITY DEFINER roster RPC — a direct students join can't resolve
    // names for students homed in other departments (RLS-scoped), but a
    // course's own admin is entitled to its full roster.
    const { data: roster } = await supabase.rpc("get_course_roster", {
      p_course_id: selectedCourse.id,
      p_academic_year: null,
    });

    if (!roster) {
      setLoading(false);
      return;
    }

    // Get existing attendance for this date
    const { data: existingAtt } = await supabase
      .from("attendance")
      .select("id, student_id, status")
      .eq("course_id", selectedCourse.id)
      .eq("lecture_date", selectedDate);

    const existingMap: Record<
      string,
      { id: string; status: "present" | "absent" | "excused" }
    > = {};
    existingAtt?.forEach((a: any) => {
      existingMap[a.student_id] = { id: a.id, status: a.status };
    });

    const studentList: StudentAttendance[] = roster.map((s: any) => {
      const existing = existingMap[s.student_id];
      return {
        studentId: s.student_id,
        name: s.name ?? "—",
        regNumber: formatRegNumber(s.reg_number),
        status: existing?.status ?? null,
        existingRecordId: existing?.id ?? null,
      };
    });

    // Sort by name
    studentList.sort((a, b) => a.name.localeCompare(b.name));
    setStudents(studentList);
    setLoading(false);
  };

  const toggleStatus = (
    studentId: string,
    status: "present" | "absent" | "excused",
  ) => {
    setStudents((prev) =>
      prev.map((s) =>
        s.studentId === studentId
          ? { ...s, status: s.status === status ? null : status }
          : s,
      ),
    );
  };

  const markAll = (status: "present" | "absent") => {
    setStudents((prev) => prev.map((s) => ({ ...s, status })));
  };

  const handleSave = async () => {
    if (!selectedCourse || !selectedDate) return;
    setSaving(true);
    setSavedMessage(null);

    const marked = students.filter((s) => s.status !== null);

    try {
      /* One request for the whole register, not one per student.
         Marking a class of forty used to mean forty sequential round trips,
         which is slow and, worse, not atomic: a failure halfway left the
         register half saved with no sign of which half. The table already
         has a unique key on (student_id, course_id, lecture_date), so the
         insert-or-update decision belongs to the database. Only the columns
         sent here are written, so a row's recorded_by and offering_id
         survive being re-marked. */
      const { error: saveError } = await supabase.from("attendance").upsert(
        marked.map((student) => ({
          student_id: student.studentId,
          course_id: selectedCourse.id,
          lecture_date: selectedDate,
          status: student.status,
        })),
        { onConflict: "student_id,course_id,lecture_date" },
      );
      if (saveError) throw saveError;

      setSavedMessage(
        `Attendance saved for ${marked.length} student(s) on ${selectedDate}.`,
      );

      // Refresh to get updated IDs
      await fetchStudentsForCourse();
    } catch (err) {
      console.error("Save error:", err);
      setSavedMessage("Error saving attendance. Please try again.");
    }

    setSaving(false);
  };

  const filteredStudents = students.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.regNumber.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const presentCount = students.filter((s) => s.status === "present").length;
  const absentCount = students.filter((s) => s.status === "absent").length;
  const unmarkedCount = students.filter((s) => s.status === null).length;

  // The sidebar does not offer this to a super admin; typing the URL should
  // not be the way round that. A register belongs to the department that
  // delivers the course, and reading one student's day by day is its business.
  if (student?.role === "super_admin") {
    return (
      <div className="space-y-5">
        <PageHeader title="Attendance" />
        <EmptyState
          icon={Calendar}
          title="Attendance is kept by the department"
          description="Registers are marked against the courses a department delivers, so they are read and corrected there. Faculty-wide attendance figures are on the dashboard."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Attendance Management
        </h1>
        <p className="text-muted-foreground text-sm">
          Select a batch, then a course and date, to mark or update
          attendance.
        </p>
      </motion.div>

      {/* Batch, Course and Date Selection */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Select Batch, Course & Date</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Batch Dropdown */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Batch
                </label>
                <select
                  value={selectedBatch ?? ""}
                  onChange={(e) =>
                    setSelectedBatch(
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                  className="w-full h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select a batch...</option>
                  {batches.map((b) => (
                    <option key={b} value={b}>
                      {describeBatch(b)}
                    </option>
                  ))}
                </select>
                {selectedBatch !== null && (
                  <p className="text-xs text-muted-foreground">
                    {batchLoading
                      ? "Detecting current semester..."
                      : batchSemester !== null
                        ? `Currently in Semester ${batchSemester}`
                        : "No active enrollments found for this batch."}
                  </p>
                )}
              </div>

              {/* Course Dropdown */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Course
                </label>
                <div className="relative">
                  <button
                    onClick={() =>
                      selectedBatch !== null &&
                      setCourseDropdownOpen(!courseDropdownOpen)
                    }
                    disabled={selectedBatch === null}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span
                      className={
                        selectedCourse
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {selectedCourse
                        ? `${selectedCourse.code} — ${selectedCourse.name}`
                        : selectedBatch === null
                          ? "Select a batch first..."
                          : "Select a course..."}
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </button>

                  {courseDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-xl shadow-lg max-h-64 overflow-y-auto">
                      {courses.map((course) => (
                        <button
                          key={course.id}
                          onClick={() => {
                            setSelectedCourse(course);
                            setCourseDropdownOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted transition-colors text-sm ${
                            selectedCourse?.id === course.id
                              ? "bg-primary/10 text-primary"
                              : "text-foreground"
                          }`}
                        >
                          <Badge className="bg-primary/10 text-primary text-xs flex-shrink-0">
                            {course.code}
                          </Badge>
                          <span className="truncate">{course.name}</span>
                          <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                            Sem {course.semester}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Date Picker */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Lecture Date
                </label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  className="h-9 bg-card border-border"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Attendance Marking */}
      {selectedCourse && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Card className="border-border">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle>
                    {selectedCourse.code} — {selectedCourse.name}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedDate} · {students.length} students enrolled
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Stats */}
                  <div className="flex items-center gap-3 text-sm mr-2">
                    <span className="flex items-center gap-1 text-green-600 font-medium">
                      <CheckCircle className="h-4 w-4" />
                      {presentCount}
                    </span>
                    <span className="flex items-center gap-1 text-red-600 font-medium">
                      <XCircle className="h-4 w-4" />
                      {absentCount}
                    </span>
                    {unmarkedCount > 0 && (
                      <span className="text-muted-foreground">
                        {unmarkedCount} unmarked
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => markAll("present")}
                    className="border-green-300 text-green-700 hover:bg-green-50"
                  >
                    All Present
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => markAll("absent")}
                    className="border-red-300 text-red-700 hover:bg-red-50"
                  >
                    All Absent
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search students..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-card border-border"
                />
              </div>

              {/* Student List */}
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-16 rounded-xl bg-muted animate-pulse"
                    />
                  ))}
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="text-center py-10">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-muted-foreground">
                    No students found for this course.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredStudents.map((student, index) => (
                    <motion.div
                      key={student.studentId}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      className={`flex items-center justify-between p-3 rounded-xl border-2 transition-all ${
                        student.status === "present"
                          ? "border-green-200 bg-green-50"
                          : student.status === "absent"
                            ? "border-red-200 bg-red-50"
                            : student.status === "excused"
                              ? "border-yellow-200 bg-yellow-50"
                              : "border-border bg-card"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
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
                          <p className="font-medium text-foreground text-sm">
                            {student.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {student.regNumber}
                          </p>
                        </div>
                      </div>

                      {/* Status Buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            toggleStatus(student.studentId, "present")
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            student.status === "present"
                              ? "bg-green-500 text-white shadow-sm"
                              : "bg-muted text-muted-foreground hover:bg-green-100 hover:text-green-700"
                          }`}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          Present
                        </button>
                        <button
                          onClick={() =>
                            toggleStatus(student.studentId, "absent")
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            student.status === "absent"
                              ? "bg-red-500 text-white shadow-sm"
                              : "bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-700"
                          }`}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Absent
                        </button>
                        <button
                          onClick={() =>
                            toggleStatus(student.studentId, "excused")
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            student.status === "excused"
                              ? "bg-yellow-500 text-white shadow-sm"
                              : "bg-muted text-muted-foreground hover:bg-yellow-100 hover:text-yellow-700"
                          }`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Excused
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Save Button */}
              {students.length > 0 && (
                <div className="pt-4 border-t border-border">
                  {savedMessage && (
                    <div
                      className={`mb-3 p-3 rounded-lg text-sm ${
                        savedMessage.includes("Error")
                          ? "bg-destructive/10 text-destructive border border-destructive/20"
                          : "bg-green-50 text-green-800 border border-green-200"
                      }`}
                    >
                      {savedMessage}
                    </div>
                  )}
                  <Button
                    onClick={handleSave}
                    disabled={
                      saving ||
                      students.filter((s) => s.status !== null).length === 0
                    }
                    className="w-full bg-primary hover:bg-primary/90 h-10"
                  >
                    {saving ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Saving...
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Save className="h-4 w-4" />
                        Save Attendance (
                        {students.filter((s) => s.status !== null).length}{" "}
                        marked)
                      </div>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Prompt when no course selected */}
      {!selectedCourse && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16"
        >
          <Calendar className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-40" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Select a course to begin
          </h3>
          <p className="text-muted-foreground text-sm">
            Choose a course and date above to mark or update attendance.
          </p>
        </motion.div>
      )}
    </div>
  );
}
