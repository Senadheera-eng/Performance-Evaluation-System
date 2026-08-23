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
  AlertCircle,
  Lock,
  FileDown,
  Pencil,
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
import { CorrectGradeDialog } from "../../components/admin/CorrectGradeDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { ErrorState, SegmentedTabs, StatusBadge } from "../../components/common";
import { PendingResultReviews } from "../../components/admin/PendingResultReviews";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getAdminScope } from "../../../lib/adminScope";
import { formatRegNumber } from "../../../lib/format";
import { gradeForMark, overallMark, useSettings } from "../../../lib/settings";
import {
  buildResultSheetFilename,
  buildResultSheetPdf,
  type ResultSheetRow,
} from "../../../lib/resultSheetPdf";
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
  department: string;
  contributesToGpa: boolean;
  /** This course's own split of the overall mark. */
  caWeight: number;
  eseWeight: number;
}

interface StudentResult {
  resultId: string | null;
  studentId: string;
  name: string;
  indexNumber: string;
  regNumber: string;
  /** Student's home department — used to group the result-sheet PDF by
   *  department for shared/IS courses. */
  department: string;
  /** The student's own admission batch — distinct from the batch whose
   *  exam sitting is currently being entered. */
  batchYear: number | null;
  /** True when batchYear doesn't match the batch being viewed: an earlier
   *  batch's student sitting this exam again alongside a younger cohort,
   *  same pattern as the "Repeat Candidates" section on the faculty's own
   *  result sheets. */
  isRepeat: boolean;
  midSem: string;
  ca: string;
  ese: string;
  oaMark: number | null;
  grade: string | null;
  gpv: number | null;
  isPublished: boolean;
  isDirty: boolean;
  /** Per-field validation messages; a row with any entry here cannot be
   *  saved or published. */
  errors: Partial<Record<"midSem" | "ca" | "ese", string>>;
}

const MARK_RANGES = {
  midSem: { max: 50, label: "Mid Sem" },
  ca: { max: 50, label: "CA" },
  ese: { max: 100, label: "ESE" },
} as const;

/** Empty string is valid (mark not yet entered) — only an out-of-range or
 *  non-numeric value is rejected. */
function validateMark(
  field: keyof typeof MARK_RANGES,
  value: string,
): string | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return "Must be a number";
  if (n < 0 || n > MARK_RANGES[field].max) {
    return `Must be 0-${MARK_RANGES[field].max}`;
  }
  return undefined;
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
  const [correcting, setCorrecting] = useState<{
    id: string;
    studentName: string;
    currentGrade: string | null;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [candidateFilter, setCandidateFilter] = useState<
    "all" | "regular" | "repeat"
  >("all");
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<
    "publish" | "unpublish" | null
  >(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [courseDropdownOpen, setCourseDropdownOpen] = useState(false);

  // Result-sheet PDF export. Course coordinator, weightage and the board
  // exam date are never persisted to `courses` — that table is deliberately
  // read-only for admins — so these are re-entered per export. The two
  // reference sheets both show the board-exam-date field blank in practice,
  // so none of this is required to generate.
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportCoordinator, setExportCoordinator] = useState("");
  const [exportCaWeight, setExportCaWeight] = useState("");
  const [exportEseWeight, setExportEseWeight] = useState("");
  const [exportMidSemWeight, setExportMidSemWeight] = useState("");
  const [exportBoardDate, setExportBoardDate] = useState("");

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
      .select(
        "id, course_code, title, semester, year, credits, department, contributes_to_gpa, ca_weight, ese_weight",
      )
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
          department: c.department,
          contributesToGpa: c.contributes_to_gpa,
          caWeight: c.ca_weight,
          eseWeight: c.ese_weight,
        })),
      );
    }
  };

  const fetchStudentResults = async () => {
    if (!selectedCourse || !selectedYear) return;
    setLoading(true);
    setFetchError(null);

    // Roster comes from a SECURITY DEFINER RPC rather than a client-side
    // join: students' RLS scopes a dept admin to their own department's
    // student rows, but a course they own is taken by students from EVERY
    // department, so a direct join can only resolve a fraction of the
    // names. The RPC validates course ownership server-side and also
    // includes students with historical result rows but no enrollment row.
    const { data: roster, error: rosterError } = await supabase.rpc(
      "get_course_roster",
      { p_course_id: selectedCourse.id, p_academic_year: selectedYear },
    );

    if (rosterError) {
      console.error("[AdminResults] failed to load roster", rosterError);
      setFetchError("Unable to load students for this course and batch.");
      setStudents([]);
      setLoading(false);
      return;
    }

    // Get existing results
    const { data: existingResults, error: resultsError } = await supabase
      .from("results")
      .select("*")
      .eq("course_id", selectedCourse.id)
      .eq("academic_year", selectedYear);

    if (resultsError) {
      console.error("[AdminResults] failed to load results", resultsError);
      setFetchError("Unable to load existing marks for this course.");
      setStudents([]);
      setLoading(false);
      return;
    }

    const resultMap: Record<string, any> = {};
    existingResults?.forEach((r: any) => {
      resultMap[r.student_id] = r;
    });

    const studentList: StudentResult[] = (roster ?? []).map((s: any) => {
      const existing = resultMap[s.student_id];
      return {
        resultId: existing?.id ?? null,
        studentId: s.student_id,
        name: s.name ?? "—",
        indexNumber: s.index_number ?? "—",
        regNumber: formatRegNumber(s.reg_number),
        department: s.department ?? "—",
        batchYear: s.batch_year ?? null,
        isRepeat:
          s.batch_year !== null &&
          selectedBatch !== null &&
          s.batch_year !== selectedBatch,
        midSem: existing?.mid_sem_mark?.toString() ?? "",
        ca: existing?.ca_mark?.toString() ?? "",
        ese: existing?.ese_mark?.toString() ?? "",
        oaMark: existing?.oa_mark ?? null,
        grade: existing?.grade ?? null,
        gpv: existing?.gpv ?? null,
        isPublished: existing?.is_published ?? false,
        isDirty: false,
        errors: {},
      };
    });

    studentList.sort((a, b) => a.indexNumber.localeCompare(b.indexNumber));
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

        const fieldError = validateMark(field, value);
        const updated = {
          ...s,
          [field]: value,
          isDirty: true,
          errors: { ...s.errors, [field]: fieldError },
        };

        const midRaw = field === "midSem" ? value : s.midSem;
        const caRaw = field === "ca" ? value : s.ca;
        const eseRaw = field === "ese" ? value : s.ese;
        const midErr = field === "midSem" ? fieldError : s.errors.midSem;
        const caErr = field === "ca" ? fieldError : s.errors.ca;
        const eseErr = field === "ese" ? fieldError : s.errors.ese;

        const mid = parseFloat(midRaw);
        const ca = parseFloat(caRaw);
        const ese = parseFloat(eseRaw);

        // Never derive a grade from a value outside its configured range —
        // an invalid mark must block the grade, not silently feed into it.
        if (
          !isNaN(mid) &&
          !isNaN(ca) &&
          !isNaN(ese) &&
          !midErr &&
          !caErr &&
          !eseErr
        ) {
          // The mid-semester mark is validated above and recorded, but it is
          // a component of CA, not a term of its own — see the handbook note
          // on overallMark.
          const oa = calculateOA(ca, ese, {
            ca: selectedCourse?.caWeight ?? settings.oaWeights.ca,
            ese: selectedCourse?.eseWeight ?? settings.oaWeights.ese,
          });
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

  /** Rows with a validation error are never sent to the database, whether
   *  saving a draft or publishing — an invalid mark should block both. */
  const dirtyValidRows = () =>
    students.filter(
      (s) => s.isDirty && !s.errors.midSem && !s.errors.ca && !s.errors.ese,
    );
  const invalidRowCount = students.filter(
    (s) => s.errors.midSem || s.errors.ca || s.errors.ese,
  ).length;

  const handleSaveDraft = async () => {
    if (!selectedCourse || !selectedYear) return;
    setSaving(true);
    setSavedMessage(null);

    const dirty = dirtyValidRows();
    let failed = 0;

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

      const { error } = student.resultId
        ? await supabase
            .from("results")
            .update(payload)
            .eq("id", student.resultId)
        : await supabase.from("results").insert(payload);

      if (error) {
        console.error("[AdminResults] failed to save draft", student.studentId, error);
        failed++;
      }
    }

    if (failed > 0) {
      setSavedMessage(
        `Saved ${dirty.length - failed} of ${dirty.length}. ${failed} could not be saved — please try again.`,
      );
    } else if (dirty.length > 0) {
      setSavedMessage(`Draft saved for ${dirty.length} student(s).`);
    } else {
      setSavedMessage("No changes to save.");
    }

    await fetchStudentResults();
    setSaving(false);
  };

  // Publishing never touches a row with no grade — an incomplete row (missing
  // or invalid marks) has nothing valid to show a student, so it's silently
  // excluded from the update rather than pushed through half-finished.
  const publishableCount = students.filter((s) => s.grade !== null).length;
  const incompleteCount = students.length - publishableCount;

  const confirmPublish = async () => {
    if (!selectedCourse || !selectedYear) return;
    setConfirmDialog(null);
    setPublishing(true);
    setSavedMessage(null);

    await handleSaveDraft();

    const { error } = await supabase
      .from("results")
      .update({ is_published: true })
      .eq("course_id", selectedCourse.id)
      .eq("academic_year", selectedYear)
      .not("grade", "is", null);

    if (error) {
      console.error("[AdminResults] failed to publish", error);
      setSavedMessage("Error publishing. Please try again.");
    } else {
      setSavedMessage(
        incompleteCount > 0
          ? `Published ${publishableCount} result(s). ${incompleteCount} skipped — missing or invalid marks.`
          : `Results published for ${publishableCount} students. Students can now view their grades.`,
      );
    }

    await fetchStudentResults();
    setPublishing(false);
  };

  const confirmUnpublish = async () => {
    if (!selectedCourse || !selectedYear) return;
    setConfirmDialog(null);
    setUnpublishing(true);
    setSavedMessage(null);

    const { error } = await supabase
      .from("results")
      .update({ is_published: false })
      .eq("course_id", selectedCourse.id)
      .eq("academic_year", selectedYear);

    if (error) {
      console.error("[AdminResults] failed to unpublish", error);
      setSavedMessage("Error unpublishing. Please try again.");
    } else {
      setSavedMessage(
        "Results unpublished. They are no longer visible to students.",
      );
    }

    await fetchStudentResults();
    setUnpublishing(false);
  };

  // The result sheet is a record of what's actually been finalised, not a
  // work-in-progress export — only published rows (which, by construction,
  // always carry a complete grade) go into it. Every row is included; there
  // is no partial-metadata block, since the reference sheets themselves
  // show the coordinator/board-date fields blank when unset.
  const handleGeneratePdf = () => {
    if (!selectedCourse || !selectedYear || !selectedBatch) return;

    const rows: ResultSheetRow[] = students
      .filter((s) => s.isPublished && s.grade)
      .map((s) => ({
        indexNumber: s.indexNumber,
        regNumber: s.regNumber,
        grade: s.grade as string,
        department: s.department,
        isRepeat: s.isRepeat,
      }));

    const meta = {
      courseCode: selectedCourse.code,
      courseTitle: selectedCourse.name,
      courseDepartment: selectedCourse.department,
      credits: selectedCourse.credits,
      contributesToGpa: selectedCourse.contributesToGpa,
      semester: selectedCourse.semester,
      batchYear: selectedBatch,
      academicYear: selectedYear,
      courseCoordinator: exportCoordinator.trim() || undefined,
      caWeight: exportCaWeight.trim() ? Number(exportCaWeight) : undefined,
      eseWeight: exportEseWeight.trim() ? Number(exportEseWeight) : undefined,
      midSemWeight: exportMidSemWeight.trim()
        ? Number(exportMidSemWeight)
        : undefined,
      boardExamDate: exportBoardDate.trim() || undefined,
    };

    const doc = buildResultSheetPdf(meta, rows);
    doc.save(buildResultSheetFilename(meta));
    setExportDialogOpen(false);
  };

  const filteredStudents = students
    .filter(
      (s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.regNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.indexNumber.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .filter((s) => {
      if (candidateFilter === "regular") return !s.isRepeat;
      if (candidateFilter === "repeat") return s.isRepeat;
      return true;
    });

  const publishedCount = students.filter((s) => s.isPublished).length;
  const draftCount = students.filter(
    (s) => !s.isPublished && s.resultId !== null,
  ).length;
  const emptyCount = students.filter((s) => s.resultId === null).length;
  const repeatCount = students.filter((s) => s.isRepeat).length;
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
          Review sheets submitted by lecturers, or enter marks directly and
          publish them to students.
        </p>
      </motion.div>

      {/* Sheets lecturers have handed over. Publication is the department's
          decision — the database refuses it to anyone else — so this is where
          that decision gets made. */}
      <PendingResultReviews
        onChanged={() => {
          if (selectedCourse && selectedYear) fetchStudentResults();
        }}
      />

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
                    {repeatCount > 0 && (
                      <span className="flex items-center gap-1 text-purple-600">
                        <Users className="h-3 w-3" />
                        {repeatCount} repeat
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={publishedCount === 0}
                    onClick={() => setExportDialogOpen(true)}
                    title={
                      publishedCount === 0
                        ? "Publish at least one result before exporting"
                        : undefined
                    }
                  >
                    <FileDown className="h-3.5 w-3.5 mr-1.5" />
                    Download Result Sheet PDF
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {fetchError && (
                <ErrorState
                  message={fetchError}
                  onRetry={fetchStudentResults}
                  size="inline"
                />
              )}

              {/* Search + candidate filter */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, index no., or reg no..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-card border-border"
                  />
                </div>
                <SegmentedTabs
                  aria-label="Filter by candidate type"
                  value={candidateFilter}
                  onChange={(v) => setCandidateFilter(v as typeof candidateFilter)}
                  layoutId="results-candidate-filter"
                  tabs={[
                    { value: "all", label: "All", count: students.length },
                    {
                      value: "regular",
                      label: "Regular",
                      count: students.length - repeatCount,
                    },
                    { value: "repeat", label: "Repeat", count: repeatCount },
                  ]}
                />
              </div>

              {/* Mark Entry Info */}
              <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                OA = CA (
                {Math.round(
                  (selectedCourse?.caWeight ?? settings.oaWeights.ca) * 100,
                )}
                %) + ESE (
                {Math.round(
                  (selectedCourse?.eseWeight ?? settings.oaWeights.ese) * 100,
                )}
                %) for this course. The mid-semester mark is one of the
                components that make up CA, so it is recorded here but does not
                carry its own share of the overall mark. Grade and GPV are
                calculated automatically. Marks outside their valid range are
                rejected and cannot be saved.
              </div>

              {/* Column Headers */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-4 text-xs font-medium text-muted-foreground">
                <div className="col-span-3">Student</div>
                <div className="col-span-2 text-center">Mid Sem (/50)</div>
                <div className="col-span-2 text-center">CA (/50)</div>
                <div className="col-span-2 text-center">ESE (/100)</div>
                <div className="col-span-2 text-center">OA / Grade / GPV</div>
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
                      : candidateFilter !== "all"
                        ? `No ${candidateFilter} candidates for this course and batch.`
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
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-start">
                        {/* Student info */}
                        <div className="md:col-span-3 flex items-center gap-2.5">
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
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium text-foreground truncate">
                                {student.name}
                              </p>
                              {student.isRepeat && (
                                <StatusBadge tone="info" className="flex-shrink-0">
                                  Repeat
                                </StatusBadge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {student.indexNumber} · {student.regNumber}
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
                            aria-invalid={!!student.errors.midSem}
                            className={`h-8 text-center text-sm bg-card ${
                              student.errors.midSem
                                ? "border-destructive focus-visible:ring-destructive/30"
                                : "border-border"
                            }`}
                          />
                          {student.errors.midSem && (
                            <p className="text-xs text-destructive mt-0.5">
                              {student.errors.midSem}
                            </p>
                          )}
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
                            aria-invalid={!!student.errors.ca}
                            className={`h-8 text-center text-sm bg-card ${
                              student.errors.ca
                                ? "border-destructive focus-visible:ring-destructive/30"
                                : "border-border"
                            }`}
                          />
                          {student.errors.ca && (
                            <p className="text-xs text-destructive mt-0.5">
                              {student.errors.ca}
                            </p>
                          )}
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
                            aria-invalid={!!student.errors.ese}
                            className={`h-8 text-center text-sm bg-card ${
                              student.errors.ese
                                ? "border-destructive focus-visible:ring-destructive/30"
                                : "border-border"
                            }`}
                          />
                          {student.errors.ese && (
                            <p className="text-xs text-destructive mt-0.5">
                              {student.errors.ese}
                            </p>
                          )}
                        </div>

                        {/* OA / Grade / GPV */}
                        <div className="md:col-span-2 flex items-center justify-center gap-2">
                          {student.grade ? (
                            <>
                              <Badge
                                className={`${getGradeColor(student.grade)} font-bold text-sm px-2 flex-shrink-0`}
                              >
                                {student.grade}
                              </Badge>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {student.oaMark?.toFixed(1)} OA
                                <br />
                                {student.gpv?.toFixed(1)} GPV
                              </span>
                              {/* A published row is otherwise locked, which is
                                  right — but a grade entered in error still has
                                  to be fixable, and editing an R back clamps to
                                  C because the row treats it as a re-sit. */}
                              {student.resultId && student.isPublished && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-1.5"
                                  title="Correct a grade recorded in error"
                                  onClick={() =>
                                    setCorrecting({
                                      id: student.resultId!,
                                      studentName: student.name,
                                      currentGrade: student.grade,
                                    })
                                  }
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  <span className="sr-only">Correct grade</span>
                                </Button>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          )}
                        </div>

                        {/* Status */}
                        <div className="md:col-span-1 flex items-center justify-center gap-1">
                          {student.isPublished ? (
                            <span
                              className="flex items-center gap-1 text-green-600 text-xs"
                              title="Published"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </span>
                          ) : student.resultId ? (
                            <span
                              className="flex items-center gap-1 text-amber-500 text-xs"
                              title="Draft — not yet published"
                            >
                              <Clock className="h-4 w-4" />
                            </span>
                          ) : (
                            <span
                              className="flex items-center gap-1 text-muted-foreground opacity-40 text-xs"
                              title="No marks entered"
                            >
                              <EyeOff className="h-4 w-4" />
                            </span>
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
                  {invalidRowCount > 0 && (
                    <div className="flex items-start gap-2 p-3 rounded-lg text-sm bg-destructive/10 text-destructive border border-destructive/20">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>
                        {invalidRowCount} row{invalidRowCount === 1 ? "" : "s"}{" "}
                        {invalidRowCount === 1 ? "has" : "have"} a mark outside
                        its valid range — fix{" "}
                        {invalidRowCount === 1 ? "it" : "them"} before saving.
                      </span>
                    </div>
                  )}

                  {savedMessage && (
                    <div
                      className={`p-3 rounded-lg text-sm ${
                        savedMessage.startsWith("Error")
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
                      disabled={saving || dirtyValidRows().length === 0}
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
                      onClick={() => setConfirmDialog("publish")}
                      disabled={publishing || publishableCount === 0}
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

                    {publishedCount > 0 && (
                      <Button
                        onClick={() => setConfirmDialog("unpublish")}
                        disabled={unpublishing}
                        variant="outline"
                        className="h-10 border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        {unpublishing ? (
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-destructive border-t-transparent rounded-full animate-spin" />
                            Unpublishing...
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Lock className="h-4 w-4" />
                            Unpublish
                          </div>
                        )}
                      </Button>
                    )}
                  </div>

                  {!allPublished && (
                    <p className="text-xs text-muted-foreground text-center">
                      Publishing sends every complete, graded row to students
                      immediately.{" "}
                      {incompleteCount > 0
                        ? `${incompleteCount} row${incompleteCount === 1 ? "" : "s"} without a grade will be skipped.`
                        : ""}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      <AlertDialog
        open={confirmDialog === "publish"}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish results to students?</AlertDialogTitle>
            <AlertDialogDescription>
              {publishableCount} student{publishableCount === 1 ? "" : "s"}{" "}
              with a complete grade will be published and can immediately see
              their result.
              {incompleteCount > 0 &&
                ` ${incompleteCount} row${incompleteCount === 1 ? "" : "s"} without a grade will be skipped, not published.`}{" "}
              This cannot be undone from the student's side, though you can
              unpublish afterward if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPublish}>
              Publish {publishableCount} result{publishableCount === 1 ? "" : "s"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDialog === "unpublish"}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish these results?</AlertDialogTitle>
            <AlertDialogDescription>
              {publishedCount} published result{publishedCount === 1 ? "" : "s"}{" "}
              for {selectedCourse?.code} will be hidden from students again.
              The marks themselves are kept as a draft — nothing is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUnpublish}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Download Result Sheet PDF</DialogTitle>
            <DialogDescription>
              {selectedCourse?.code} — {publishedCount} published result
              {publishedCount === 1 ? "" : "s"} for {selectedYear}
              {repeatCount > 0
                ? `, including ${repeatCount} repeat candidate${repeatCount === 1 ? "" : "s"}`
                : ""}
              . These fields are optional and only used for this PDF — they
              are not saved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Course Coordinator
              </label>
              <Input
                placeholder="e.g. Dr. Jane Silva"
                value={exportCoordinator}
                onChange={(e) => setExportCoordinator(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Mid Sem Weightage
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  placeholder="0.4"
                  value={exportMidSemWeight}
                  onChange={(e) => setExportMidSemWeight(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  CA Weightage
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  placeholder="0.3"
                  value={exportCaWeight}
                  onChange={(e) => setExportCaWeight(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  ESE Weightage
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  placeholder="0.7"
                  value={exportEseWeight}
                  onChange={(e) => setExportEseWeight(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Date of Board of Examination
              </label>
              <Input
                placeholder="e.g. 12th March 2026"
                value={exportBoardDate}
                onChange={(e) => setExportBoardDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleGeneratePdf}>
              <FileDown className="h-4 w-4 mr-1.5" />
              Generate PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <CorrectGradeDialog
        open={correcting !== null}
        onOpenChange={(open) => !open && setCorrecting(null)}
        result={correcting}
        onCorrected={fetchStudentResults}
      />
    </div>
  );
}
