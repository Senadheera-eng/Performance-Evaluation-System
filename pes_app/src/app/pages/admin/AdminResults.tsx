import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  Search,
  Save,
  Eye,
  EyeOff,
  ChevronDown,
  Users,
  CheckCircle,
  Clock,
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
import { useAuth } from "../../context/AuthContext";
import { getAdminScope } from "../../../lib/adminScope";
import { formatRegNumber } from "../../../lib/format";
import { gradeForMark, overallMark, useSettings } from "../../../lib/settings";
import { describeBatch } from "../../../lib/batch";

interface Course {
  id: string;
  code: string;
  name: string;
  semester: number;
  /** Study year 1-4 (semesters 1-2, 3-4, 5-6, 7-8) — used to derive which
   *  academic_year a given batch's results for this course belong to. */
  year: number;
  credits: number;
}

interface StudentResult {
  resultId: string | null;
  studentId: string;
  name: string;
  regNumber: string;
  midSem: string;
  ca: string;
  ese: string;
  oaMark: number | null;
  grade: string | null;
  gpv: number | null;
  isPublished: boolean;
  isDirty: boolean;
}

// Grade boundaries and component weights come from the regulation engine
// (system_settings), so a faculty with a different scale can reconfigure
// them without a code change.
const calculateGrade = gradeForMark;
const calculateOA = overallMark;

const getGradeColor = (grade: string | null) => {
  if (!grade) return "bg-gray-100 text-gray-500";
  if (grade.startsWith("A")) return "bg-green-100 text-green-700";
  if (grade.startsWith("B")) return "bg-blue-100 text-blue-700";
  if (grade.startsWith("C")) return "bg-yellow-100 text-yellow-700";
  if (grade === "F") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
};

// A batch's results for a given course live under exactly one academic
// year, derived from when that batch actually took that study year — not a
// value an admin should have to know or pick by hand. Matches the formula
// the database itself was corrected to (batch_year + course.year - 1) /
// (batch_year + course.year): a Batch 7 (2021 intake) student's year-1
// courses fall under 2021/2022, year-2 under 2022/2023, and so on.
const deriveAcademicYear = (batchYear: number, courseYear: number): string =>
  `${batchYear + courseYear - 1}/${batchYear + courseYear}`;

export default function AdminResults() {
  const { student } = useAuth();
  const settings = useSettings();
  const scope = getAdminScope(student);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [batches, setBatches] = useState<number[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [students, setStudents] = useState<StudentResult[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [courseDropdownOpen, setCourseDropdownOpen] = useState(false);

  // The academic year for the currently-selected course/batch combination —
  // always derived, never picked by hand, so it can't drift out of sync
  // with what the database actually has these results filed under.
  const selectedYear =
    selectedCourse && selectedBatch !== null
      ? deriveAcademicYear(selectedBatch, selectedCourse.year)
      : null;

  useEffect(() => {
    if (student) fetchCourses();
  }, [student]);

  useEffect(() => {
    fetchBatches();
  }, []);

  useEffect(() => {
    if (selectedCourse && selectedYear) fetchStudentResults();
  }, [selectedCourse, selectedYear]);

  const fetchBatches = async () => {
    const { data } = await supabase
      .from("students")
      .select("batch_year")
      .eq("role", "student");

    const distinct = [...new Set((data ?? []).map((s: any) => s.batch_year))]
      .filter((y): y is number => y !== null)
      .sort((a, b) => b - a);
    setBatches(distinct);
    setSelectedBatch((current) => current ?? distinct[0] ?? null);
  };

  const fetchCourses = async () => {
    let courseQuery = supabase
      .from("courses")
      .select("id, course_code, title, semester, year, credits")
      .order("semester")
      .order("course_code");
    if (scope.kind === "department") {
      courseQuery = courseQuery.eq("department", scope.department);
    }
    const { data } = await courseQuery;

    if (data) {
      setCourses(
        data.map((c: any) => ({
          id: c.id,
          code: c.course_code,
          name: c.title,
          semester: c.semester,
          year: c.year,
          credits: c.credits,
        })),
      );
    }
  };

  const fetchStudentResults = async () => {
    if (!selectedCourse || !selectedYear) return;
    setLoading(true);

    // Roster comes from a SECURITY DEFINER RPC rather than a client-side
    // join: students' RLS scopes a dept admin to their own department's
    // student rows, but a course they own is taken by students from EVERY
    // department, so a direct join can only resolve a fraction of the
    // names. The RPC validates course ownership server-side and also
    // includes students with historical result rows but no enrollment row.
    const { data: roster } = await supabase.rpc("get_course_roster", {
      p_course_id: selectedCourse.id,
      p_academic_year: selectedYear,
    });

    if (!roster) {
      setLoading(false);
      return;
    }

    // Get existing results
    const { data: existingResults } = await supabase
      .from("results")
      .select("*")
      .eq("course_id", selectedCourse.id)
      .eq("academic_year", selectedYear);

    const resultMap: Record<string, any> = {};
    existingResults?.forEach((r: any) => {
      resultMap[r.student_id] = r;
    });

    const studentList: StudentResult[] = roster.map((s: any) => {
      const existing = resultMap[s.student_id];
      return {
        resultId: existing?.id ?? null,
        studentId: s.student_id,
        name: s.name ?? "—",
        regNumber: formatRegNumber(s.reg_number),
        midSem: existing?.mid_sem_mark?.toString() ?? "",
        ca: existing?.ca_mark?.toString() ?? "",
        ese: existing?.ese_mark?.toString() ?? "",
        oaMark: existing?.oa_mark ?? null,
        grade: existing?.grade ?? null,
        gpv: existing?.gpv ?? null,
        isPublished: existing?.is_published ?? false,
        isDirty: false,
      };
    });

    studentList.sort((a, b) => a.name.localeCompare(b.name));
    setStudents(studentList);
    setLoading(false);
  };

  const updateMark = (
    studentId: string,
    field: "midSem" | "ca" | "ese",
    value: string,
  ) => {
    setStudents((prev) =>
      prev.map((s) => {
        if (s.studentId !== studentId) return s;

        const updated = { ...s, [field]: value, isDirty: true };

        // Auto-calculate OA and grade if all three are filled
        const mid =
          field === "midSem" ? parseFloat(value) : parseFloat(s.midSem);
        const ca = field === "ca" ? parseFloat(value) : parseFloat(s.ca);
        const ese = field === "ese" ? parseFloat(value) : parseFloat(s.ese);

        if (!isNaN(mid) && !isNaN(ca) && !isNaN(ese)) {
          const oa = calculateOA(mid, ca, ese);
          const { grade, gpv } = calculateGrade(oa);
          updated.oaMark = oa;
          updated.grade = grade;
          updated.gpv = gpv;
        } else {
          updated.oaMark = null;
          updated.grade = null;
          updated.gpv = null;
        }

        return updated;
      }),
    );
  };

  const handleSaveDraft = async () => {
    if (!selectedCourse || !selectedYear) return;
    setSaving(true);
    setSavedMessage(null);

    const dirty = students.filter((s) => s.isDirty);

    try {
      for (const student of dirty) {
        const payload = {
          student_id: student.studentId,
          course_id: selectedCourse.id,
          academic_year: selectedYear,
          mid_sem_mark: student.midSem ? parseFloat(student.midSem) : null,
          ca_mark: student.ca ? parseFloat(student.ca) : null,
          ese_mark: student.ese ? parseFloat(student.ese) : null,
          oa_mark: student.oaMark,
          grade: student.grade,
          gpv: student.gpv,
          is_published: false,
        };

        if (student.resultId) {
          await supabase
            .from("results")
            .update(payload)
            .eq("id", student.resultId);
        } else {
          await supabase.from("results").insert(payload);
        }
      }

      setSavedMessage(`Draft saved for ${dirty.length} student(s).`);
      await fetchStudentResults();
    } catch (err) {
      setSavedMessage("Error saving. Please try again.");
    }

    setSaving(false);
  };

  const handlePublish = async () => {
    if (!selectedCourse || !selectedYear) return;
    setPublishing(true);
    setSavedMessage(null);

    try {
      // First save any dirty records
      await handleSaveDraft();

      // Then publish all results for this course + year
      await supabase
        .from("results")
        .update({ is_published: true })
        .eq("course_id", selectedCourse.id)
        .eq("academic_year", selectedYear);

      setSavedMessage(
        `Results published for ${students.length} students. Students can now view their grades.`,
      );
      await fetchStudentResults();
    } catch (err) {
      setSavedMessage("Error publishing. Please try again.");
    }

    setPublishing(false);
  };

  const filteredStudents = students.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.regNumber.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const publishedCount = students.filter((s) => s.isPublished).length;
  const draftCount = students.filter(
    (s) => !s.isPublished && s.resultId !== null,
  ).length;
  const emptyCount = students.filter((s) => s.resultId === null).length;
  const allPublished =
    students.length > 0 && publishedCount === students.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Results Management
        </h1>
        <p className="text-muted-foreground text-sm">
          Enter student marks, save as draft, then publish to make them visible
          to students.
        </p>
      </motion.div>

      {/* Course and Batch Selection */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Select Course & Batch</CardTitle>
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
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left"
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

            {/* Batch */}
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
              {selectedCourse && selectedBatch !== null && (
                <p className="text-xs text-muted-foreground">
                  Academic year {selectedYear} for this batch and course.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Entry */}
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
                    {selectedBatch !== null && describeBatch(selectedBatch)} ·{" "}
                    {selectedYear} · {students.length} students ·{" "}
                    {selectedCourse.credits} credits
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-green-600">
                      <Eye className="h-3 w-3" />
                      {publishedCount} published
                    </span>
                    <span className="flex items-center gap-1 text-amber-600">
                      <Clock className="h-3 w-3" />
                      {draftCount} draft
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <EyeOff className="h-3 w-3" />
                      {emptyCount} empty
                    </span>
                  </div>
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

              {/* Mark Entry Info */}
              <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                OA = Mid Sem ({Math.round(settings.oaWeights.mid_sem * 100)}%) +
                CA ({Math.round(settings.oaWeights.ca * 100)}%) + ESE (
                {Math.round(settings.oaWeights.ese * 100)}%). Grade and GPV are
                calculated automatically.
              </div>

              {/* Column Headers */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-4 text-xs font-medium text-muted-foreground">
                <div className="col-span-4">Student</div>
                <div className="col-span-2 text-center">Mid Sem (/50)</div>
                <div className="col-span-2 text-center">CA (/50)</div>
                <div className="col-span-2 text-center">ESE (/100)</div>
                <div className="col-span-1 text-center">Grade</div>
                <div className="col-span-1 text-center">Status</div>
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
                    {searchQuery
                      ? "No students match your search."
                      : `No students enrolled in this course for ${
                          selectedBatch !== null ? describeBatch(selectedBatch) : "this batch"
                        }.`}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredStudents.map((student, index) => (
                    <motion.div
                      key={student.studentId}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.02 }}
                      className={`p-3 rounded-xl border transition-all ${
                        student.isPublished
                          ? "border-green-200 bg-green-50/50"
                          : student.isDirty
                            ? "border-amber-200 bg-amber-50/50"
                            : "border-border bg-card"
                      }`}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                        {/* Student info */}
                        <div className="md:col-span-4 flex items-center gap-2.5">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
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
                            <p className="text-sm font-medium text-foreground">
                              {student.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {student.regNumber}
                            </p>
                          </div>
                        </div>

                        {/* Mid Sem */}
                        <div className="md:col-span-2">
                          <label className="md:hidden text-xs text-muted-foreground mb-1 block">
                            Mid Sem (/50)
                          </label>
                          <Input
                            type="number"
                            min="0"
                            max="50"
                            placeholder="0-50"
                            value={student.midSem}
                            onChange={(e) =>
                              updateMark(
                                student.studentId,
                                "midSem",
                                e.target.value,
                              )
                            }
                            disabled={student.isPublished}
                            className="h-8 text-center text-sm bg-card border-border"
                          />
                        </div>

                        {/* CA */}
                        <div className="md:col-span-2">
                          <label className="md:hidden text-xs text-muted-foreground mb-1 block">
                            CA (/50)
                          </label>
                          <Input
                            type="number"
                            min="0"
                            max="50"
                            placeholder="0-50"
                            value={student.ca}
                            onChange={(e) =>
                              updateMark(
                                student.studentId,
                                "ca",
                                e.target.value,
                              )
                            }
                            disabled={student.isPublished}
                            className="h-8 text-center text-sm bg-card border-border"
                          />
                        </div>

                        {/* ESE */}
                        <div className="md:col-span-2">
                          <label className="md:hidden text-xs text-muted-foreground mb-1 block">
                            ESE (/100)
                          </label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            placeholder="0-100"
                            value={student.ese}
                            onChange={(e) =>
                              updateMark(
                                student.studentId,
                                "ese",
                                e.target.value,
                              )
                            }
                            disabled={student.isPublished}
                            className="h-8 text-center text-sm bg-card border-border"
                          />
                        </div>

                        {/* Grade */}
                        <div className="md:col-span-1 flex justify-center">
                          {student.grade ? (
                            <Badge
                              className={`${getGradeColor(student.grade)} font-bold text-sm px-2`}
                            >
                              {student.grade}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          )}
                        </div>

                        {/* Status */}
                        <div className="md:col-span-1 flex justify-center">
                          {student.isPublished ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : student.resultId ? (
                            <Clock className="h-4 w-4 text-amber-500" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-muted-foreground opacity-40" />
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              {students.length > 0 && (
                <div className="pt-4 border-t border-border space-y-3">
                  {savedMessage && (
                    <div
                      className={`p-3 rounded-lg text-sm ${
                        savedMessage.includes("Error")
                          ? "bg-destructive/10 text-destructive border border-destructive/20"
                          : "bg-green-50 text-green-800 border border-green-200"
                      }`}
                    >
                      {savedMessage}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      onClick={handleSaveDraft}
                      disabled={
                        saving || students.filter((s) => s.isDirty).length === 0
                      }
                      variant="outline"
                      className="flex-1 h-10 border-amber-300 text-amber-700 hover:bg-amber-50"
                    >
                      {saving ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                          Saving...
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Save className="h-4 w-4" />
                          Save Draft
                        </div>
                      )}
                    </Button>

                    <Button
                      onClick={handlePublish}
                      disabled={publishing || allPublished}
                      className="flex-1 h-10 bg-primary hover:bg-primary/90"
                    >
                      {publishing ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Publishing...
                        </div>
                      ) : allPublished ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4" />
                          All Published
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Eye className="h-4 w-4" />
                          Publish Results to Students
                        </div>
                      )}
                    </Button>
                  </div>

                  {!allPublished && (
                    <p className="text-xs text-muted-foreground text-center">
                      Publishing will make results visible to students
                      immediately. This cannot be undone.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {!selectedCourse && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16"
        >
          <TrendingUp className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-40" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Select a course to begin
          </h3>
          <p className="text-muted-foreground text-sm">
            Choose a course and academic year above to enter or update results.
          </p>
        </motion.div>
      )}
    </div>
  );
}
