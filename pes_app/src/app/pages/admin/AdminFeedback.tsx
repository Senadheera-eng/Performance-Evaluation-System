import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  MessageSquareText,
  Users,
  CheckCircle2,
  Star,
  EyeOff,
  Eye,
  Plus,
  ChevronDown,
  ChevronUp,
  Lock,
  Archive,
  PlayCircle,
  AlertTriangle,
  Sparkles,
  X,
  Download,
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
import { FeedbackReleasePanel } from "../../components/admin/FeedbackReleasePanel";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getAdminScope, describeAdminScope } from "../../../lib/adminScope";
import { describeBatch } from "../../../lib/batch";
import { useSettings } from "../../../lib/settings";
import { formatRegNumber } from "../../../lib/format";
import {
  getAdminFeedbackPeriods,
  getAdminFeedbackSummary,
  getCourseAnalytics,
  getQuestionAnalytics,
  getFeedbackComments,
  getQuestionBank,
  createFeedbackPeriod,
  setPeriodCourses,
  setPeriodQuestions,
  updatePeriodStatus,
  getPeriodCourseIds,
  getPeriodQuestionIds,
  createQuestion,
  AdminFeedbackPeriod,
  AdminFeedbackSummary,
  CourseAnalytics,
  QuestionAnalytics,
  FeedbackComment,
  FeedbackQuestion,
  buildFeedbackCsv,
  downloadCsv,
  buildFeedbackExcel,
  downloadExcel,
} from "../../../lib/feedbackService";


const STATUS_COLOR: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-blue-100 text-blue-700",
  open: "bg-green-100 text-green-700",
  closed: "bg-amber-100 text-amber-700",
  archived: "bg-gray-100 text-gray-500",
};

interface SimpleCourse {
  id: string;
  code: string;
  title: string;
  semester: number;
}

export default function AdminFeedback() {
  const { student: admin } = useAuth();
  const scope = getAdminScope(admin);
  const [viewMode, setViewMode] = useState<"analytics" | "periods">(
    "analytics",
  );

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
          Feedback for courses in {describeAdminScope(admin)}.
        </p>
      </motion.div>

      <div className="flex gap-1 p-1 rounded-lg bg-muted w-fit">
        {(
          [
            { value: "analytics", label: "Analytics" },
            { value: "periods", label: "Manage Periods" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            onClick={() => setViewMode(tab.value)}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
            style={
              viewMode === tab.value
                ? { backgroundColor: "#C41E3A", color: "white" }
                : {}
            }
          >
            <span
              className={
                viewMode === tab.value ? "text-white" : "text-muted-foreground"
              }
            >
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      {/* The department's two decisions — approving forms lecturers want to
          run, and releasing results to the lecturers they are about. Shown
          above both tabs because they are time-sensitive: a lecturer is
          waiting on each one. */}
      <FeedbackReleasePanel />

      {viewMode === "analytics" ? (
        <AnalyticsView />
      ) : (
        <PeriodsView adminId={admin?.id ?? ""} scopeDepartment={scope} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Analytics view
// ---------------------------------------------------------------------

function AnalyticsView() {
  const settings = useSettings();
  const [periods, setPeriods] = useState<AdminFeedbackPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string>("");
  const [courseId, setCourseId] = useState<string>("");
  const [summary, setSummary] = useState<AdminFeedbackSummary | null>(null);
  const [courseAnalytics, setCourseAnalytics] = useState<CourseAnalytics[]>(
    [],
  );
  const [questionAnalytics, setQuestionAnalytics] = useState<
    QuestionAnalytics[]
  >([]);
  const [comments, setComments] = useState<FeedbackComment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await getAdminFeedbackPeriods();
      setPeriods(data);
      if (data.length > 0) setPeriodId(data[0].id);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!periodId) return;
    setCourseId("");
    loadPeriodData();
  }, [periodId]);

  useEffect(() => {
    if (!periodId) return;
    loadFilteredData();
  }, [courseId]);

  const loadPeriodData = async () => {
    setLoading(true);
    const [s, c] = await Promise.all([
      getAdminFeedbackSummary(periodId, null, null),
      getCourseAnalytics(periodId),
    ]);
    setSummary(s);
    setCourseAnalytics(c);
    const [q, cm] = await Promise.all([
      getQuestionAnalytics(periodId, null),
      getFeedbackComments(periodId, null),
    ]);
    setQuestionAnalytics(q);
    setComments(cm);
    setLoading(false);
  };

  const loadFilteredData = async () => {
    const cid = courseId || null;
    const [s, q, cm] = await Promise.all([
      getAdminFeedbackSummary(periodId, cid, null),
      getQuestionAnalytics(periodId, cid),
      getFeedbackComments(periodId, cid),
    ]);
    setSummary(s);
    setQuestionAnalytics(q);
    setComments(cm);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (periods.length === 0) {
    return (
      <div className="text-center py-16">
        <MessageSquareText className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No feedback periods yet
        </h3>
        <p className="text-muted-foreground text-sm">
          Create one under "Manage Periods" to start collecting feedback.
        </p>
      </div>
    );
  }

  const handleExport = (format: "csv" | "excel") => {
    const period = periods.find((p) => p.id === periodId);
    if (!period) return;
    const scoped = courseId
      ? courseAnalytics.filter((c) => c.course_id === courseId)
      : courseAnalytics;
    const slug = period.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "csv") {
      downloadCsv(
        `feedback-${slug}-${stamp}.csv`,
        buildFeedbackCsv(period, scoped, questionAnalytics, comments),
      );
    } else {
      downloadExcel(
        `feedback-${slug}-${stamp}.xls`,
        buildFeedbackExcel(period, scoped, questionAnalytics, comments),
      );
    }
  };

  const selectedCourse = courseAnalytics.find((c) => c.course_id === courseId);
  const smallGroupHidden =
    courseId && selectedCourse && selectedCourse.response_count < settings.feedbackMinResponsesForAnalytics;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className="h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm flex-1"
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} — {p.status}
            </option>
          ))}
        </select>
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm flex-1"
        >
          <option value="">All Courses</option>
          {courseAnalytics.map((c) => (
            <option key={c.course_id} value={c.course_id}>
              {c.course_code} — {c.title}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          onClick={() => handleExport("csv")}
          className="h-9"
        >
          <Download className="h-4 w-4 mr-1.5" />
          CSV
        </Button>
        <Button
          variant="outline"
          onClick={() => handleExport("excel")}
          className="h-9"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Excel
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Eligible Students",
            value: summary?.total_eligible ?? 0,
            icon: Users,
            color: "bg-primary/10 text-primary",
          },
          {
            label: "Response Rate",
            value: `${summary?.response_rate ?? 0}%`,
            icon: CheckCircle2,
            color: "bg-green-100 text-green-700",
          },
          {
            label: "Avg Rating",
            value: summary?.overall_avg_rating ?? "—",
            icon: Star,
            color: "bg-amber-100 text-amber-700",
          },
          {
            label: "Anonymous / Identified",
            value: `${summary?.anonymous_count ?? 0} / ${summary?.non_anonymous_count ?? 0}`,
            icon: EyeOff,
            color: "bg-blue-100 text-blue-700",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-card rounded-xl p-3 border border-border shadow-sm"
          >
            <div className="flex items-center gap-2.5">
              <div className={`p-1.5 rounded-lg ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">
                  {stat.value}
                </p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Course analytics table (only shown for "All Courses") */}
      {!courseId && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Course Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 pr-3">Course</th>
                  <th className="pb-2 pr-3">Eligible</th>
                  <th className="pb-2 pr-3">Responses</th>
                  <th className="pb-2 pr-3">Rate</th>
                  <th className="pb-2 pr-3">Avg Rating</th>
                  <th className="pb-2">Anon / Named</th>
                </tr>
              </thead>
              <tbody>
                {courseAnalytics.map((c) => (
                  <tr
                    key={c.course_id}
                    className="border-b border-border/50 hover:bg-muted/40 cursor-pointer"
                    onClick={() => setCourseId(c.course_id)}
                  >
                    <td className="py-2 pr-3">
                      <span className="font-medium text-foreground">
                        {c.course_code}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {c.title}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{c.eligible_count}</td>
                    <td className="py-2 pr-3">{c.response_count}</td>
                    <td className="py-2 pr-3">{c.response_rate}%</td>
                    <td className="py-2 pr-3">{c.avg_rating ?? "—"}</td>
                    <td className="py-2">
                      {c.anonymous_count} / {c.non_anonymous_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {smallGroupHidden ? (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-900">
            Detailed analytics are hidden because this course has fewer than{" "}
            {settings.feedbackMinResponsesForAnalytics} responses.
          </p>
        </div>
      ) : (
        <>
          {/* Question analytics */}
          {questionAnalytics.length > 0 && (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-base">Question Ratings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {questionAnalytics.map((q) => (
                  <div key={q.question_id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-medium text-foreground">
                        {q.question_text}
                      </p>
                      <span className="text-sm font-semibold text-primary flex-shrink-0 ml-2">
                        {q.avg_rating ?? "—"} avg
                      </span>
                    </div>
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
                      {[1, 2, 3, 4, 5].map((v) => {
                        const count = (q as any)[`count_${v}`] as number;
                        const pct = q.response_count
                          ? (count / q.response_count) * 100
                          : 0;
                        return (
                          <div
                            key={v}
                            style={{
                              width: `${pct}%`,
                              backgroundColor:
                                v <= 2
                                  ? "#ef4444"
                                  : v === 3
                                    ? "#f59e0b"
                                    : "#22c55e",
                            }}
                            title={`${v} stars: ${count}`}
                          />
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {q.response_count} responses · {q.pct_positive ?? 0}%
                      positive · {q.pct_neutral ?? 0}% neutral ·{" "}
                      {q.pct_negative ?? 0}% negative
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Comments */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base">
                Written Comments{" "}
                <span className="text-muted-foreground font-normal text-sm">
                  ({comments.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No comments yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {comments.map((c, i) => (
                    <div
                      key={`${c.submission_id}-${i}`}
                      className="p-3 rounded-xl border border-border bg-muted/30"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge className="bg-primary/10 text-primary text-xs">
                            {c.course_code}
                          </Badge>
                          {c.question_category && (
                            <Badge variant="outline" className="text-xs">
                              {c.question_category}
                            </Badge>
                          )}
                          {c.is_anonymous ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <EyeOff className="h-3 w-3" />
                              Anonymous
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-foreground">
                              <Eye className="h-3 w-3" />
                              {c.student_name} ({formatRegNumber(c.student_reg)})
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {c.submitted_date}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">
                        {c.question_text}
                      </p>
                      <p className="text-sm text-foreground">{c.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Periods (management) view
// ---------------------------------------------------------------------

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
        <div className="p-3 rounded-xl bg-green-50 border border-green-200 text-sm text-green-800">
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
        <div className="text-center py-12 text-muted-foreground text-sm">
          No feedback periods yet.
        </div>
      ) : (
        <div className="space-y-3">
          {periods.map((p) => (
            <PeriodCard
              key={p.id}
              period={p}
              adminId={adminId}
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
  const [batchYear, setBatchYear] = useState<number | "">("");
  const [department, setDepartment] = useState(
    scopeDepartment.kind === "department" ? scopeDepartment.department : "",
  );
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [allowEditing, setAllowEditing] = useState(true);
  const [batches, setBatches] = useState<number[]>([]);
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
              onChange={(e) => setSemester(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
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

        {error && <p className="text-sm text-red-600">{error}</p>}

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
  expanded,
  onToggle,
  onChanged,
}: {
  period: AdminFeedbackPeriod;
  adminId: string;
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
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState("");
  const [newQuestionType, setNewQuestionType] = useState<
    "rating" | "short_text" | "long_text"
  >("rating");
  const [newQuestionCategory, setNewQuestionCategory] = useState("");
  const [newQuestionRequired, setNewQuestionRequired] = useState(true);
  const [addingQuestionSaving, setAddingQuestionSaving] = useState(false);

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

  const handleAddQuestion = async () => {
    if (!newQuestionText.trim()) {
      setError("Please enter the question text.");
      return;
    }
    setAddingQuestionSaving(true);
    setError(null);
    const result = await createQuestion({
      question_text: newQuestionText.trim(),
      question_type: newQuestionType,
      category: newQuestionCategory.trim() || null,
      is_required: newQuestionRequired,
      created_by: adminId,
    });
    setAddingQuestionSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setQuestionBank((prev) => [...prev, result.question]);
    setSelectedQuestionIds((prev) => [...prev, result.question.id]);
    setNewQuestionText("");
    setNewQuestionCategory("");
    setNewQuestionType("rating");
    setNewQuestionRequired(true);
    setAddingQuestion(false);
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
              Sem {period.semester} · {period.academic_year}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(period.opens_at).toLocaleString()} →{" "}
              {new Date(period.closes_at).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {period.status === "draft" && (
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTransition("open");
                }}
              >
                <PlayCircle className="h-3.5 w-3.5 mr-1" />
                Open
              </Button>
            )}
            {period.status === "open" && (
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
            {period.status === "closed" && (
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
                        disabled={period.status !== "draft"}
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
                                      period.status === "draft" && toggleCourse(c.id)
                                    }
                                    className="cursor-pointer"
                                  >
                                    <Checkbox
                                      checked={isSelected}
                                      className="mr-1 pointer-events-none"
                                    />
                                    <Badge className="bg-primary/10 text-primary text-xs flex-shrink-0">
                                      {c.code}
                                    </Badge>
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
                            {period.status === "draft" && (
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
                  <div className="border border-border rounded-xl max-h-48 overflow-y-auto divide-y divide-border">
                    {questionBank.map((q) => (
                      <label
                        key={q.id}
                        className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedQuestionIds.includes(q.id)}
                          onCheckedChange={() => toggleQuestion(q.id)}
                          disabled={period.status !== "draft"}
                        />
                        <span className="truncate flex-1">
                          {q.question_text}
                        </span>
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {q.question_type === "rating" ? "Rating" : "Text"}
                        </Badge>
                      </label>
                    ))}
                  </div>

                  {period.status === "draft" && (
                    <div className="mt-2">
                      {!addingQuestion ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAddingQuestion(true)}
                        >
                          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                          Add Custom Question
                        </Button>
                      ) : (
                        <div className="p-3 rounded-xl border border-dashed border-border space-y-2">
                          <Input
                            placeholder="Question text..."
                            value={newQuestionText}
                            onChange={(e) => setNewQuestionText(e.target.value)}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={newQuestionType}
                              onChange={(e) =>
                                setNewQuestionType(e.target.value as any)
                              }
                              className="h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm"
                            >
                              <option value="rating">Rating (1-5)</option>
                              <option value="short_text">Short answer</option>
                              <option value="long_text">Long answer</option>
                            </select>
                            <Input
                              placeholder="Category (optional)"
                              value={newQuestionCategory}
                              onChange={(e) =>
                                setNewQuestionCategory(e.target.value)
                              }
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={newQuestionRequired}
                              onCheckedChange={(v) =>
                                setNewQuestionRequired(!!v)
                              }
                            />
                            Required
                          </label>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={() => {
                                setAddingQuestion(false);
                                setNewQuestionText("");
                              }}
                              disabled={addingQuestionSaving}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1 bg-primary hover:bg-primary/90"
                              onClick={handleAddQuestion}
                              disabled={addingQuestionSaving}
                            >
                              {addingQuestionSaving ? "Adding..." : "Add"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                {period.status === "draft" && (
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
    </Card>
  );
}
