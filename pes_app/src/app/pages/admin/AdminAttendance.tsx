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
import { supabase } from "../../../lib/supabase";

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
  const [courses, setCourses] = useState<Course[]>([]);
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
    fetchCourses();
  }, []);

  useEffect(() => {
    if (selectedCourse && selectedDate) {
      fetchStudentsForCourse();
    }
  }, [selectedCourse, selectedDate]);

  const fetchCourses = async () => {
    const { data } = await supabase
      .from("courses")
      .select("id, course_code, title, semester")
      .order("semester")
      .order("course_code");

    if (data) {
      setCourses(
        data.map((c: any) => ({
          id: c.id,
          code: c.course_code,
          name: c.title,
          semester: c.semester,
        })),
      );
    }
  };

  const fetchStudentsForCourse = async () => {
    if (!selectedCourse) return;
    setLoading(true);

    // Get all students enrolled in this course
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select(
        `
        student_id,
        students (id, name, reg_number)
      `,
      )
      .eq("course_id", selectedCourse.id)
      .in("status", ["enrolled", "completed"]);

    if (!enrollments) {
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

    const studentList: StudentAttendance[] = enrollments.map((e: any) => {
      const existing = existingMap[e.student_id];
      return {
        studentId: e.student_id,
        name: e.students?.name ?? "—",
        regNumber: e.students?.reg_number ?? "—",
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
      for (const student of marked) {
        if (student.existingRecordId) {
          // Update existing
          await supabase
            .from("attendance")
            .update({ status: student.status })
            .eq("id", student.existingRecordId);
        } else {
          // Insert new
          await supabase.from("attendance").insert({
            student_id: student.studentId,
            course_id: selectedCourse.id,
            lecture_date: selectedDate,
            status: student.status,
          });
        }
      }

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Attendance Management
        </h1>
        <p className="text-muted-foreground">
          Select a course and date to mark or update attendance.
        </p>
      </motion.div>

      {/* Course and Date Selection */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Select Course & Date</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Course Dropdown */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Course
                </label>
                <div className="relative">
                  <button
                    onClick={() => setCourseDropdownOpen(!courseDropdownOpen)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left"
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
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted transition-colors text-sm ${
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
                  className="h-12 bg-card border-border"
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
                      className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                        student.status === "present"
                          ? "border-green-200 bg-green-50"
                          : student.status === "absent"
                            ? "border-red-200 bg-red-50"
                            : student.status === "excused"
                              ? "border-yellow-200 bg-yellow-50"
                              : "border-border bg-card"
                      }`}
                    >
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
                    className="w-full bg-primary hover:bg-primary/90 h-12"
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
