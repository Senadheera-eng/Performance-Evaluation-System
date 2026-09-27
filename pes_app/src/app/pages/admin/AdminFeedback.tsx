import { CourseCode, EmptyState, StatusBadge } from "../../components/common";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  EyeOff,
  Eye,
  Plus,
  ChevronDown,
  ChevronUp,
  Lock,
  Archive,
  PlayCircle,
  Sparkles,
  X,
  MessageSquareText,
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
import { Checkbox } from "../../components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/ui/command";
import { FeedbackApprovals } from "../../components/admin/FeedbackApprovals";
import { QuestionEditorDialog } from "../../components/admin/QuestionEditorDialog";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getAdminScope, describeAdminScope } from "../../../lib/adminScope";
import { describeBatch } from "../../../lib/batch";
import { useSettings } from "../../../lib/settings";
import {
  getAdminFeedbackPeriods,
  getQuestionBank,
  createFeedbackPeriod,
  setPeriodCourses,
  setPeriodQuestions,
  updatePeriodStatus,
  getPeriodCourseIds,
  getPeriodQuestionIds,
  createQuestion,
  updateQuestion,
  QuestionDraft,
  AdminFeedbackPeriod,
  FeedbackQuestion,
} from "../../../lib/feedbackService";


const QUESTION_TYPE_LABEL: Record<string, string> = {
  rating: "Rating 1–5",
  single_choice: "Choose one",
  yes_no: "Yes / No",
  short_text: "Short answer",
  long_text: "Long answer",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-neutral-bg text-neutral-fg",
  scheduled: "bg-info-bg text-info-fg",
  open: "bg-success-bg text-success-fg",
  closed: "bg-warning-bg text-warning-fg",
  archived: "bg-neutral-bg text-neutral-fg",
};

/**
 * Whether students can actually see this period, in one line.
 *
 * "Open" is a stored status, not an answer: a period keeps that status after
 * its closing date passes, and the database also requires now to be inside the
 * window before a student is shown anything. A row reading "open" while
 * students saw nothing for the past week is how Open and Release got confused
 * for each other, so the real answer is stated rather than implied by a badge.
 */
function StudentVisibility({
  period,
}: {
  period: { status: string; opens_at: string; closes_at: string };
}) {
  const now = Date.now();
  const opens = new Date(period.opens_at).getTime();
  const closes = new Date(period.closes_at).getTime();

  let live = false;
  let message: string;

  if (period.status !== "open") {
    message =
      period.status === "closed" || period.status === "archived"
        ? "Closed — students can no longer fill this in"
        : "Not open yet — students cannot see this";
  } else if (now < opens) {
    message = `Opens ${new Date(period.opens_at).toLocaleString()} — students cannot see it yet`;
  } else if (now > closes) {
    message = `The window closed ${new Date(period.closes_at).toLocaleDateString()} — students can no longer see it`;
  } else {
    live = true;
    message = "Students can fill this in now";
  }

  return (
    <p
      className={`mt-1 flex items-center gap-1.5 text-xs ${
        live ? "text-success-fg" : "text-muted-foreground"
      }`}
    >
      {live ? (
        <Eye className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      ) : (
        <EyeOff className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      )}
      {message}
    </p>
  );
}

interface SimpleCourse {
  id: string;
  code: string;
  title: string;
  semester: number;
}

export default function AdminFeedback() {
  const { student: admin } = useAuth();
  const scope = getAdminScope(admin);
  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Course Feedback
        </h1>
        <p className="text-muted-foreground text-sm">
          Feedback rounds for {describeAdminScope(admin)} — create one, let its
          lecturers shape their own course forms, open it, then close it.
        </p>
      </motion.div>

      {/* Forms lecturers asked the department to run. */}
      <FeedbackApprovals />

      <PeriodsView adminId={admin?.id ?? ""} scopeDepartment={scope} />
    </div>
  );
}

function PeriodsView({
  adminId,
  scopeDepartment,
}: {
  adminId: string;
  scopeDepartment: { kind: "all" } | { kind: "department"; department: string };
}) {
  const [periods, setPeriods] = useState<AdminFeedbackPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchPeriods();
  }, []);

  const fetchPeriods = async () => {
    setLoading(true);
    setPeriods(await getAdminFeedbackPeriods());
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {saveMessage && (
        <div className="p-3 rounded-xl bg-success-bg border border-success-border text-sm text-success-fg">
          {saveMessage}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => setCreating(!creating)}
          className="bg-primary hover:bg-primary/90"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Period
        </Button>
      </div>

      {creating && (
        <CreatePeriodForm
          adminId={adminId}
          scopeDepartment={scopeDepartment}
          onCreated={() => {
            setCreating(false);
            setSaveMessage("Feedback period created as a draft.");
            fetchPeriods();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : periods.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="No feedback rounds yet"
          description="Create a round with New Period. Its lecturers then shape their own course forms, and you open it to students when they are ready."
        />
      ) : (
        <div className="space-y-3">
          {periods.map((p) => (
            <PeriodCard
              key={p.id}
              period={p}
              adminId={adminId}
              managedElsewhere={scopeDepartment.kind === "department" && p.department === null}
              expanded={expandedId === p.id}
              onToggle={() =>
                setExpandedId(expandedId === p.id ? null : p.id)
              }
              onChanged={() => {
                fetchPeriods();
                setSaveMessage(null);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CreatePeriodForm({
  adminId,
  scopeDepartment,
  onCreated,
  onCancel,
}: {
  adminId: string;
  scopeDepartment: { kind: "all" } | { kind: "department"; department: string };
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [academicYear, setAcademicYear] = useState(
    `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`,
  );
  const [semester, setSemester] = useState(1);
  /* Which round of the semester this is. The two are not interchangeable —
     mid-semester feedback is meant to change the course the students are
     still sitting in, and end-of-semester feedback is a verdict on one that
     has finished. Every screen already distinguishes them; this form was the
     one place that could not say which it was making. */
  const [feedbackType, setFeedbackType] = useState<
    "mid_semester" | "end_semester"
  >("end_semester");
  const [batchYear, setBatchYear] = useState<number | "">("");
  const [department, setDepartment] = useState(
    scopeDepartment.kind === "department" ? scopeDepartment.department : "",
  );
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [allowEditing, setAllowEditing] = useState(true);
  const [batches, setBatches] = useState<number[]>([]);
  /* The semester the chosen batch is sitting now, worked out from that
     batch's own published results. Used to label the list and to open it
     somewhere sensible — a round is nearly always about the semester the
     batch is in or the one it has just finished, and this form opened on
     Semester 1 whatever batch was chosen. */
  const [batchSemester, setBatchSemester] = useState<number | null>(null);
  const [semesterTouched, setSemesterTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettings();
  // Course-owning departments: the four student departments plus
  // Interdisciplinary Studies, which owns shared courses but no students.
  const DEPARTMENTS = [
    ...settings.studentDepartments,
    settings.interdisciplinaryDepartment,
  ];

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("batch_year")
        .eq("role", "student");
      const distinct = [...new Set((data ?? []).map((s: any) => s.batch_year))]
        .filter((y): y is number => y !== null)
        .sort((a, b) => b - a);
      setBatches(distinct);
      if (distinct.length > 0) setBatchYear(distinct[0]);
    })();
  }, []);

  useEffect(() => {
    if (!batchYear) {
      setBatchSemester(null);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("current_semester_for_batch", { p_batch_year: Number(batchYear) })
      .then(({ data }) => {
        if (cancelled) return;
        const sem = typeof data === "number" ? data : null;
        setBatchSemester(sem);
        /* Only until the admin picks for themselves — a round for an
           earlier semester is perfectly normal and must not be overwritten
           when the batch is re-selected. */
        if (!semesterTouched && sem && sem >= 1 && sem <= 8) setSemester(sem);
      });
    return () => {
      cancelled = true;
    };
  }, [batchYear, semesterTouched]);

  const handleCreate = async () => {
    setError(null);
    if (!title || !batchYear || !opensAt || !closesAt) {
      setError("Please fill in all fields.");
      return;
    }
    if (scopeDepartment.kind === "department" && !department) {
      setError("Please select a department.");
      return;
    }
    if (new Date(closesAt) <= new Date(opensAt)) {
      setError("Closing date must be after the opening date.");
      return;
    }

    setSaving(true);
    const result = await createFeedbackPeriod({
      title,
      academic_year: academicYear,
      semester,
      batch_year: Number(batchYear),
      feedback_type: feedbackType,
      department:
        scopeDepartment.kind === "department"
          ? scopeDepartment.department
          : department || null,
      opens_at: new Date(opensAt).toISOString(),
      closes_at: new Date(closesAt).toISOString(),
      allow_editing: allowEditing,
      created_by: adminId,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated();
  };

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-base">New Feedback Period</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Semester 6 Course Feedback"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Academic Year
            </label>
            <Input
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Semester
            </label>
            <select
              value={semester}
              onChange={(e) => {
                setSemesterTouched(true);
                setSemester(Number(e.target.value));
              }}
              className="w-full h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                  {s === batchSemester ? " (Current)" : ""}
                </option>
              ))}
            </select>
            {batchSemester !== null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {describeBatch(Number(batchYear))} is in Semester{" "}
                {batchSemester} now. A round may cover an earlier semester —
                the courses below follow whichever you pick.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Feedback round
            </label>
            <div className="flex gap-1.5">
              {(
                [
                  ["mid_semester", "Mid semester"],
                  ["end_semester", "End semester"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={feedbackType === value ? "default" : "outline"}
                  onClick={() => setFeedbackType(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {feedbackType === "mid_semester"
                ? "Asked while the course is still running, so the answers can still change it."
                : "Asked once the course has finished — a verdict rather than a course correction."}
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Batch
            </label>
            <select
              value={batchYear}
              onChange={(e) => setBatchYear(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm"
            >
              {batches.map((b) => (
                <option key={b} value={b}>
                  {describeBatch(b)}
                </option>
              ))}
            </select>
          </div>
          {scopeDepartment.kind === "all" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Department
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm"
              >
                <option value="">All Departments (faculty-wide)</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Opens At
            </label>
            <Input
              type="datetime-local"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Closes At
            </label>
            <Input
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={allowEditing}
            onCheckedChange={(v) => setAllowEditing(!!v)}
          />
          Allow students to edit their response until the period closes
        </label>

        {error && <p className="text-sm text-danger-fg">{error}</p>}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-primary hover:bg-primary/90"
            onClick={handleCreate}
            disabled={saving}
          >
            {saving ? "Creating..." : "Create as Draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PeriodCard({
  period,
  adminId,
  managedElsewhere = false,
  expanded,
  onToggle,
  onChanged,
}: {
  period: AdminFeedbackPeriod;
  adminId: string;
  /** A faculty-wide round seen by a department admin: theirs to watch, the
   *  super admin's to change. The database refuses their edits anyway. */
  managedElsewhere?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [courses, setCourses] = useState<SimpleCourse[]>([]);
  const [questionBank, setQuestionBank] = useState<FeedbackQuestion[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [courseDropdownOpen, setCourseDropdownOpen] = useState(false);
  const [questionEditorOpen, setQuestionEditorOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<FeedbackQuestion | null>(
    null,
  );

  /* Courses, questions and Open are set while the round is a draft, and
     only by whoever owns it. */
  const editable = period.status === "draft" && !managedElsewhere;

  useEffect(() => {
    if (expanded && !loaded) loadConfig();
  }, [expanded]);

  const loadConfig = async () => {
    let courseQuery = supabase
      .from("courses")
      .select("id, course_code, title, semester")
      .order("course_code");
    if (period.department) {
      courseQuery = courseQuery.eq("department", period.department);
    }
    const [{ data: courseData }, bank, existingCourses, existingQuestions] =
      await Promise.all([
        courseQuery,
        getQuestionBank(),
        getPeriodCourseIds(period.id),
        getPeriodQuestionIds(period.id),
      ]);

    const courseList = (courseData ?? []).map((c: any) => ({
      id: c.id,
      code: c.course_code,
      title: c.title,
      semester: c.semester,
    }));
    setCourses(courseList);
    setQuestionBank(bank);
    // Default to every course matching the period's own semester — the
    // admin can still hand-adjust the selection before saving.
    setSelectedCourseIds(
      existingCourses.length > 0
        ? existingCourses
        : courseList
            .filter((c) => c.semester === period.semester)
            .map((c) => c.id),
    );
    setSelectedQuestionIds(
      existingQuestions.length > 0 ? existingQuestions : bank.map((q) => q.id),
    );
    setLoaded(true);
  };

  /** Create or update, depending on whether the editor was opened on a row.
   *  A newly created question is selected straight away — an admin who just
   *  wrote it almost always wants it on the period they are configuring. */
  const handleSaveQuestion = async (draft: QuestionDraft) => {
    setError(null);
    if (editingQuestion) {
      const result = await updateQuestion(editingQuestion.id, draft);
      if (!result.ok) return { ok: false, error: result.error };
      setQuestionBank((prev) =>
        prev.map((q) => (q.id === result.question.id ? result.question : q)),
      );
      return { ok: true };
    }

    const result = await createQuestion({ ...draft, created_by: adminId });
    if (!result.ok) return { ok: false, error: result.error };
    setQuestionBank((prev) => [...prev, result.question]);
    setSelectedQuestionIds((prev) => [...prev, result.question.id]);
    return { ok: true };
  };

  const toggleCourse = (id: string) =>
    setSelectedCourseIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  const toggleQuestion = (id: string) =>
    setSelectedQuestionIds((prev) =>
      prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id],
    );

  const handleSaveConfig = async () => {
    setSaving(true);
    setError(null);
    const [r1, r2] = await Promise.all([
      setPeriodCourses(period.id, selectedCourseIds),
      setPeriodQuestions(period.id, selectedQuestionIds),
    ]);
    setSaving(false);
    if (!r1.ok || !r2.ok) {
      setError(r1.error ?? r2.error ?? "Could not save configuration.");
      return;
    }
    onChanged();
  };

  const handleTransition = async (
    status: "open" | "closed" | "archived" | "scheduled",
  ) => {
    setError(null);
    const result = await updatePeriodStatus(period.id, status);
    if (!result.ok) {
      setError(result.error ?? "Could not update period status.");
      return;
    }
    onChanged();
  };

  return (
    <Card className="border-border">
      <CardContent className="p-3">
        <div
          className="flex items-center justify-between gap-2 flex-wrap cursor-pointer"
          onClick={onToggle}
        >
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">
                {period.title}
              </span>
              <Badge className={STATUS_COLOR[period.status]}>
                {period.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {period.department ?? "All Departments"} ·{" "}
              {period.batch_year ? describeBatch(period.batch_year) : "—"} ·
              Sem {period.semester} · {period.academic_year} ·{" "}
              {/* Two rounds can cover the same semester, so the row has to say
                  which one it is or they read as duplicates. */}
              <span className="font-medium text-foreground">
                {period.feedback_type === "mid_semester"
                  ? "Mid semester"
                  : "End semester"}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(period.opens_at).toLocaleString()} →{" "}
              {new Date(period.closes_at).toLocaleString()}
            </p>
            <StudentVisibility period={period} />
          </div>
          <div className="flex items-center gap-2">
            {managedElsewhere && (
              <StatusBadge tone="neutral">Managed by the Super Admin</StatusBadge>
            )}
            {editable && (
              <Button
                size="sm"
                className="bg-[var(--success-600)] text-white hover:bg-[var(--success-700)]"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTransition("open");
                }}
              >
                <PlayCircle className="h-3.5 w-3.5 mr-1" />
                Open
              </Button>
            )}
            {period.status === "open" && !managedElsewhere && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTransition("closed");
                }}
              >
                <Lock className="h-3.5 w-3.5 mr-1" />
                Close
              </Button>
            )}
            {period.status === "closed" && !managedElsewhere && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTransition("archived");
                }}
              >
                <Archive className="h-3.5 w-3.5 mr-1" />
                Archive
              </Button>
            )}
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Outside the expanded block on purpose. Open, Close and Archive sit
            in the header and are clickable while the card is collapsed, and
            the database refuses some of them for good reasons — a period with
            no courses cannot open. Rendered only alongside the configuration,
            that refusal was invisible and the button looked broken. */}
        {error && <p className="mt-2 text-sm text-danger-fg">{error}</p>}

        {expanded && (
          <div className="mt-4 pt-4 border-t border-border space-y-4">
            {!loaded ? (
              <div className="h-24 rounded-lg bg-muted animate-pulse" />
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">
                    Courses
                  </p>
                  <Popover open={courseDropdownOpen} onOpenChange={setCourseDropdownOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={!editable}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className={selectedCourseIds.length ? "text-foreground" : "text-muted-foreground"}>
                          {selectedCourseIds.length === 0
                            ? "Select courses..."
                            : `${selectedCourseIds.length} course${selectedCourseIds.length !== 1 ? "s" : ""} selected`}
                        </span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[min(28rem,90vw)] p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Search by course code or name..." />
                        <CommandList>
                          <CommandEmpty>No courses found for Semester {period.semester}.</CommandEmpty>
                          <CommandGroup>
                            {courses
                              .filter((c) => c.semester === period.semester)
                              .map((c) => {
                                const isSelected = selectedCourseIds.includes(c.id);
                                return (
                                  <CommandItem
                                    key={c.id}
                                    value={`${c.code} ${c.title}`}
                                    onSelect={() =>
                                      editable && toggleCourse(c.id)
                                    }
                                    className="cursor-pointer"
                                  >
                                    <Checkbox
                                      checked={isSelected}
                                      className="mr-1 pointer-events-none"
                                    />
                                    <CourseCode code={c.code} className="text-xs flex-shrink-0" />
                                    <span className="truncate flex-1">{c.title}</span>
                                    <span className="text-xs text-muted-foreground flex-shrink-0">
                                      Sem {c.semester}
                                    </span>
                                  </CommandItem>
                                );
                              })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  {selectedCourseIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {selectedCourseIds.map((id) => {
                        const c = courses.find((course) => course.id === id);
                        if (!c) return null;
                        return (
                          <Badge
                            key={id}
                            className="bg-primary/10 text-primary text-xs flex items-center gap-1"
                          >
                            {c.code}
                            {editable && (
                              <button
                                type="button"
                                onClick={() => toggleCourse(id)}
                                className="hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground mb-2">
                    Questions ({selectedQuestionIds.length} selected)
                  </p>
                  <div className="border border-border rounded-xl max-h-64 overflow-y-auto divide-y divide-border">
                    {questionBank.map((q) => (
                      <div
                        key={q.id}
                        className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedQuestionIds.includes(q.id)}
                          onCheckedChange={() => toggleQuestion(q.id)}
                          disabled={!editable}
                          aria-label={q.question_text}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{q.question_text}</span>
                          <span className="block text-xs text-muted-foreground">
                            {QUESTION_TYPE_LABEL[q.question_type] ?? q.question_type}
                            {q.category ? ` · ${q.category}` : ""}
                            {q.target_type === "lecturer" && " · per lecturer"}
                            {q.depends_on_question_id && " · conditional"}
                            {!q.is_required && " · optional"}
                          </span>
                        </span>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingQuestion(q);
                              setQuestionEditorOpen(true);
                            }}
                            className="flex-shrink-0 rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {editable && (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingQuestion(null);
                          setQuestionEditorOpen(true);
                        }}
                      >
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        New Question
                      </Button>
                    </div>
                  )}
                </div>

                {editable && (
                  <Button
                    size="sm"
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="bg-primary hover:bg-primary/90"
                  >
                    {saving ? "Saving..." : "Save Configuration"}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>

      <QuestionEditorDialog
        open={questionEditorOpen}
        onOpenChange={(open) => {
          setQuestionEditorOpen(open);
          if (!open) setEditingQuestion(null);
        }}
        existing={editingQuestion}
        bank={questionBank}
        onSave={handleSaveQuestion}
      />
    </Card>
  );
}
