import { formatDateTime } from "../../../lib/format";
import {
  CourseCode,
  DepartmentSelect,
  EmptyState,
  PageHeader,
  PillTabs,
  SectionCard,
  SkeletonRows,
  StatStrip,
  StatusBadge,
  useExpandMotion,
  type StatusTone,
  type StripItem,
} from "../../components/common";
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  EyeOff,
  Eye,
  Plus,
  ChevronDown,
  Lock,
  Archive,
  PlayCircle,
  Sparkles,
  X,
  MessageSquareText,
  FilePen,
  CalendarPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
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
import { getAdminScope, describeAdminReach } from "../../../lib/adminScope";
import { describeBatch } from "../../../lib/batch";
import { useSettings } from "../../../lib/settings";
import {
  getAdminFeedbackPeriods,
  getQuestionBank,
  createFeedbackPeriod,
  setPeriodCourses,
  setPeriodQuestions,
  updatePeriodStatus,
  extendFeedbackPeriod,
  getPeriodCourseIds,
  getPeriodCourseCodes,
  getPeriodQuestionIds,
  createQuestion,
  updateQuestion,
  QuestionDraft,
  AdminFeedbackPeriod,
  FeedbackQuestion,
} from "../../../lib/feedbackService";
import { departmentByCourseCode, departmentStripeClass } from "../../../lib/departments";
import { cn } from "../../components/ui/utils";


const QUESTION_TYPE_LABEL: Record<string, string> = {
  rating: "Rating 1–5",
  single_choice: "Choose one",
  yes_no: "Yes / No",
  short_text: "Short answer",
  long_text: "Long answer",
};

const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  scheduled: "info",
  open: "success",
  closed: "warning",
  archived: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
  archived: "Archived",
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
    message = `Opens ${formatDateTime(period.opens_at)} — students cannot see it yet`;
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

/** The Course choice in a new round that means "every course in the semester". */
const ALL_COURSES = "__all__";

export default function AdminFeedback() {
  const { student: admin } = useAuth();
  const scope = getAdminScope(admin);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Course Feedback"
        description={`Feedback rounds for ${describeAdminReach(admin)} — create one, let its lecturers shape their own course forms, open it, then close it.`}
      />

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
  /** Each round's course codes, so a single-course round says so on its row. */
  const [courseCodes, setCourseCodes] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expand = useExpandMotion();

  useEffect(() => {
    fetchPeriods();
  }, []);

  const fetchPeriods = async () => {
    setLoading(true);
    const list = await getAdminFeedbackPeriods();
    setPeriods(list);
    setCourseCodes(await getPeriodCourseCodes(list.map((p) => p.id)));
    setLoading(false);
  };

  /* The rounds by where they stand, as chips. */
  const strip: StripItem[] = (
    [
      ["open", Eye, "success"],
      ["draft", FilePen, "neutral"],
      ["scheduled", PlayCircle, "info"],
      ["closed", Lock, "warning"],
      ["archived", Archive, "neutral"],
    ] as const
  )
    .map(([status, icon, tone]) => ({
      label: STATUS_LABEL[status].toLowerCase(),
      value: periods.filter((p) => p.status === status).length,
      icon,
      tone,
    }))
    .filter((it) => it.value > 0);

  return (
    <div className="space-y-4">
      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            key="create"
            variants={expand}
            initial="collapsed"
            animate="open"
            exit="collapsed"
            className="overflow-hidden"
          >
            <CreatePeriodForm
              adminId={adminId}
              scopeDepartment={scopeDepartment}
              onCreated={(courseCode) => {
                setCreating(false);
                toast.success(
                  courseCode
                    ? `Feedback round for ${courseCode} created as a draft.`
                    : "Feedback period created as a draft.",
                );
                fetchPeriods();
              }}
              onCancel={() => setCreating(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <SectionCard
        title="Feedback rounds"
        description="Open a round to see its courses and questions."
        actions={
          <Button onClick={() => setCreating(!creating)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Period
          </Button>
        }
        bodyClassName="space-y-3"
      >
        {!loading && strip.length > 0 && <StatStrip items={strip} />}
        {loading ? (
          <SkeletonRows count={3} height="h-24" />
        ) : periods.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="No feedback rounds yet"
            description="Create a round with New Period. Its lecturers then shape their own course forms, and you open it to students when they are ready."
            size="inline"
          />
        ) : (
          periods.map((p) => (
            <PeriodCard
              key={p.id}
              period={p}
              courseCodes={courseCodes.get(p.id) ?? []}
              adminId={adminId}
              managedElsewhere={scopeDepartment.kind === "department" && p.department === null}
              expanded={expandedId === p.id}
              onToggle={() =>
                setExpandedId(expandedId === p.id ? null : p.id)
              }
              onChanged={() => {
                fetchPeriods();
              }}
            />
          ))
        )}
      </SectionCard>
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
  /** Called once the round exists, with its course when it covers just one. */
  onCreated: (courseCode?: string) => void;
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
  /* Optionally, one course. Left at "All courses" the round covers the
     whole semester, as it always has; with a course chosen it covers that
     course alone, so its students see only that course's form and the
     round's answers are that course's. The list is the same one the
     round's card offers later: the semester's courses in its department. */
  const [semesterCourses, setSemesterCourses] = useState<SimpleCourse[]>([]);
  const [courseId, setCourseId] = useState(ALL_COURSES);
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

  const courseDepartment =
    scopeDepartment.kind === "department" ? scopeDepartment.department : department;

  useEffect(() => {
    let cancelled = false;
    // A course chosen for another semester or department is not on the new list.
    setCourseId(ALL_COURSES);
    let query = supabase
      .from("courses")
      .select("id, course_code, title, semester")
      .eq("semester", semester)
      .order("course_code");
    if (courseDepartment) query = query.eq("department", courseDepartment);
    query.then(({ data }) => {
      if (cancelled) return;
      const rows = (data ?? []) as unknown as {
        id: string;
        course_code: string;
        title: string;
        semester: number;
      }[];
      setSemesterCourses(
        rows.map((c) => ({ id: c.id, code: c.course_code, title: c.title, semester: c.semester })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [semester, courseDepartment]);

  const chosenCourse = semesterCourses.find((c) => c.id === courseId) ?? null;

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

    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    // The round exists; give it its one course, if one was chosen.
    if (chosenCourse) {
      const courses = await setPeriodCourses(result.id, [chosenCourse.id]);
      if (!courses.ok) {
        toast.error("The round was created, but its course was not set", {
          description: `${courses.error ?? ""} Open the round and choose its course.`.trim(),
        });
      }
    }
    setSaving(false);
    onCreated(chosenCourse?.code);
  };

  return (
    <SectionCard title="New Feedback Period" bodyClassName="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                chosenCourse
                  ? `e.g. ${chosenCourse.code} ${feedbackType === "mid_semester" ? "Mid-semester" : "End-semester"} Feedback`
                  : "e.g. Semester 6 Course Feedback"
              }
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
            <Select
              value={String(semester)}
              onValueChange={(v) => {
                setSemesterTouched(true);
                setSemester(Number(v));
              }}
            >
              <SelectTrigger aria-label="Semester" className="h-9 w-full rounded-control border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    Semester {s}
                    {s === batchSemester ? " (Current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {batchSemester !== null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {describeBatch(Number(batchYear))} is in Semester{" "}
                {batchSemester} now. A round may cover an earlier semester —
                the course list follows whichever you pick.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Course <span className="font-normal">(optional)</span>
            </label>
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger
                aria-label="Course"
                className="h-9 w-full rounded-control border-border bg-card [&_[data-slot=select-value]]:min-w-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COURSES}>All courses in Semester {semester}</SelectItem>
                {semesterCourses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <CourseCode code={c.code} className="text-xs flex-shrink-0" />
                    <span className="truncate">{c.title}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {chosenCourse
                ? `Only ${chosenCourse.code} is in this round: its students see this one form, and the answers are this course's alone.`
                : semesterCourses.length > 0
                  ? `All ${semesterCourses.length} Semester ${semester} courses are included. Pick one to run feedback on that course alone.`
                  : `No Semester ${semester} courses found${courseDepartment ? ` in ${courseDepartment}` : ""}.`}
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Feedback round
            </label>
            <PillTabs
              aria-label="Feedback round"
              layoutId="feedback-round-type"
              value={feedbackType}
              onChange={(v) => setFeedbackType(v as "mid_semester" | "end_semester")}
              tabs={[
                { value: "mid_semester", label: "Mid semester" },
                { value: "end_semester", label: "End semester" },
              ]}
            />
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
            <Select
              value={batchYear === "" ? undefined : String(batchYear)}
              onValueChange={(v) => setBatchYear(Number(v))}
            >
              <SelectTrigger aria-label="Batch" className="h-9 w-full rounded-control border-border bg-card">
                <SelectValue placeholder="Choose a batch" />
              </SelectTrigger>
              <SelectContent>
                {batches.map((b) => (
                  <SelectItem key={b} value={String(b)}>
                    {describeBatch(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {scopeDepartment.kind === "all" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Department
              </label>
              <DepartmentSelect
                value={department}
                onChange={setDepartment}
                departments={DEPARTMENTS}
                allLabel="All Departments (faculty-wide)"
              />
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

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating..." : "Create as Draft"}
          </Button>
        </div>
    </SectionCard>
  );
}

function PeriodCard({
  period,
  courseCodes,
  adminId,
  managedElsewhere = false,
  expanded,
  onToggle,
  onChanged,
}: {
  period: AdminFeedbackPeriod;
  /** The round's course codes as saved, for the row's own label. */
  courseCodes: string[];
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
  const [extending, setExtending] = useState(false);
  const expand = useExpandMotion();
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
    <div className={cn("rounded-card border border-border bg-card", departmentStripeClass(period.department))}>
      <div className="p-4">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">
                {period.title}
              </span>
              <StatusBadge tone={STATUS_TONE[period.status] ?? "neutral"} dot>
                {STATUS_LABEL[period.status] ?? period.status}
              </StatusBadge>
              {/* A round on one course says which, without opening it. */}
              {courseCodes.length === 1 && (
                <StatusBadge tone="info">{courseCodes[0]} only</StatusBadge>
              )}
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
              {formatDateTime(period.opens_at)} →{" "}
              {formatDateTime(period.closes_at)}
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
            {/* A later closing time while it is open, so students who need
                a few more days get them. Faculty-wide rounds are the Super
                Admin's to extend, as they are to close. */}
            {period.status === "open" && !managedElsewhere && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setExtending(true);
                }}
              >
                <CalendarPlus className="h-3.5 w-3.5 mr-1" />
                Extend
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
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-200",
                expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Outside the expanded block on purpose. Open, Close and Archive sit
            in the header and are clickable while the card is collapsed, and
            the database refuses some of them for good reasons — a period with
            no courses cannot open. Rendered only alongside the configuration,
            that refusal was invisible and the button looked broken. */}
        {error && <p className="mt-2 text-sm text-danger-fg">{error}</p>}

        <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="config"
            variants={expand}
            initial="collapsed"
            animate="open"
            exit="collapsed"
            className="overflow-hidden"
          >
          <div className="mt-4 pt-4 border-t border-border space-y-4">
            {!loaded ? (
              <SkeletonRows count={2} height="h-12" />
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
                        className="w-full flex items-center justify-between px-3 py-2 rounded-control border border-border bg-card hover:bg-muted transition-colors text-left text-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
                                    className={`cursor-pointer border-l-4 ${
                                      departmentByCourseCode(c.code)?.stripeClass ?? "border-l-transparent"
                                    } ${departmentByCourseCode(c.code)?.commandClass ?? ""}`}
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
                          <span
                            key={id}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              departmentByCourseCode(c.code)?.chipClass ?? "bg-primary/10 text-primary"
                            }`}
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
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground mb-2">
                    Questions ({selectedQuestionIds.length} selected)
                  </p>
                  <div className="border border-border rounded-control max-h-64 overflow-y-auto divide-y divide-border">
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
                  >
                    {saving ? "Saving..." : "Save Configuration"}
                  </Button>
                )}
              </>
            )}
          </div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {extending && (
        <ExtendFeedbackDialog
          period={period}
          onClose={() => setExtending(false)}
          onExtended={(message) => {
            setExtending(false);
            toast.success(message);
            onChanged();
          }}
        />
      )}

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
    </div>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** An ISO time as a datetime-local input's value, in the browser's time. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * A later closing time for an open round, as an enrolment window is
 * extended. Only later: a round is never cut short under students who are
 * still answering it. If the closing time has already passed, a later one
 * lets students answer again, since a round accepts answers only between
 * its opening and closing times.
 */
function ExtendFeedbackDialog({
  period,
  onClose,
  onExtended,
}: {
  period: AdminFeedbackPeriod;
  onClose: () => void;
  onExtended: (message: string) => void;
}) {
  const closes = new Date(period.closes_at).getTime();
  const ended = closes < Date.now();
  // Counted from the current closing time, or from now if that has passed.
  const base = Math.max(closes, Date.now());
  const [value, setValue] = useState(() => toLocalInput(new Date(base + 7 * DAY_MS).toISOString()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const next = new Date(value).getTime();
    if (!value || Number.isNaN(next)) return setError("Pick a new closing date and time.");
    if (next <= closes) return setError("The new closing time must be later than the current one.");
    if (next <= Date.now()) return setError("The new closing time must be in the future.");
    setSaving(true);
    setError(null);
    const iso = new Date(next).toISOString();
    const result = await extendFeedbackPeriod(period.id, iso);
    setSaving(false);
    if (!result.ok) return setError(`Could not extend the round: ${result.error ?? ""}`.trim());
    onExtended(`${period.title} now closes ${formatDateTime(iso)}.`);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Extend {period.title}</DialogTitle>
          <DialogDescription>
            {ended
              ? `It stopped taking answers on ${formatDateTime(period.closes_at)}. A later closing time lets students answer again.`
              : `It closes on ${formatDateTime(period.closes_at)}.`}{" "}
            Students see the new closing time on their Feedback page.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">New closing time</span>
            <Input
              type="datetime-local"
              value={value}
              min={toLocalInput(new Date(base).toISOString())}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "+1 day", days: 1 },
              { label: "+3 days", days: 3 },
              { label: "+1 week", days: 7 },
            ].map((q) => (
              <Button
                key={q.days}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setValue(toLocalInput(new Date(base + q.days * DAY_MS).toISOString()))}
              >
                {q.label}
              </Button>
            ))}
          </div>
          {error && <p className="text-sm text-danger-fg">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Extending…" : "Extend"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
