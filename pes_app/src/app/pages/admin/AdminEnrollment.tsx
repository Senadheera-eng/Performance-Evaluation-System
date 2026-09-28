import { formatDateTime } from "../../../lib/format";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Plus,
  Lock,
  PlayCircle,
  Users,
  Calendar,
  Pencil,
  Archive,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
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
import { CourseCode, DepartmentSelect, SegmentedTabs } from "../../components/common";
import { PeriodCourseBreakdown } from "../../components/enrollment/PeriodCourseBreakdown";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { useSettings } from "../../../lib/settings";
import { departmentByCourseCode, departmentStripeClass } from "../../../lib/departments";

type PeriodStatus = "draft" | "scheduled" | "open" | "closed" | "archived";

const STATUS_COLOR: Record<PeriodStatus, string> = {
  draft: "bg-neutral-bg text-neutral-fg",
  scheduled: "bg-info-bg text-info-fg",
  open: "bg-success-bg text-success-fg",
  closed: "bg-warning-bg text-warning-fg",
  archived: "bg-neutral-bg text-neutral-fg",
};

interface EnrollmentPeriod {
  id: string;
  title: string;
  academic_year: string;
  semester: number;
  /** Null when no batch is in this semester — a repeat-only window. */
  batch_year: number | null;
  department: string | null;
  opens_at: string;
  closes_at: string;
  status: PeriodStatus;
  instructions: string | null;
  eligibleCount?: number;
  enrolledCount?: number;
}

interface CourseOption {
  id: string;
  code: string;
  title: string;
  semester: number;
  department: string;
}

const ALL_TABS = [
  { value: "current", label: "Current" },
  /* Windows not yet open. Only the Super Admin has anything to do with one
     — they create windows as drafts and schedule them — so for a department,
     which can only read, it was a tab that mostly said nothing. */
  { value: "upcoming", label: "Upcoming" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
] as const;
type TabValue = (typeof ALL_TABS)[number]["value"];

export default function AdminEnrollment() {
  const { student: admin } = useAuth();
  const isSuperAdmin = admin?.role === "super_admin";
  const [periods, setPeriods] = useState<EnrollmentPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<EnrollmentPeriod | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabValue>("current");
  const TABS = ALL_TABS.filter((t) => t.value !== "upcoming" || isSuperAdmin);
  // One period open at a time. What is inside it — the courses, and each
  // course's roster — belongs to PeriodCourseBreakdown, which the staff
  // portal renders too.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (admin) fetchPeriods();
  }, [admin]);

  const fetchPeriods = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("enrollment_periods")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[AdminEnrollment] failed to load periods", error);
      setMessage("Unable to load enrolment periods.");
      setLoading(false);
      return;
    }

    const list = (data ?? []) as EnrollmentPeriod[];

    // Eligible/enrolled counts come from a SECURITY DEFINER RPC rather than
    // a direct client join to `students` — that join fails RLS for any
    // student outside the caller's own department, and a period can span
    // every department (or, with department = NULL, all of them at once).
    const withCounts = await Promise.all(
      list.map(async (p) => {
        const { data: summary, error: summaryError } = await supabase.rpc(
          "get_enrollment_period_summary",
          { p_period_id: p.id },
        );
        if (summaryError) {
          console.error(
            "[AdminEnrollment] failed to load period summary",
            p.id,
            summaryError,
          );
          return p;
        }
        const row = summary?.[0];
        return {
          ...p,
          eligibleCount: row?.eligible_count ?? 0,
          enrolledCount: row?.enrolled_count ?? 0,
        };
      }),
    );

    setPeriods(withCounts);
    setLoading(false);
  };

  const setStatus = async (id: string, status: PeriodStatus) => {
    const { error } = await supabase
      .from("enrollment_periods")
      .update({ status })
      .eq("id", id);
    if (error) {
      setMessage(`Could not update the period: ${error.message}`);
      return;
    }
    const VERBS: Record<PeriodStatus, string> = {
      draft: "reverted to draft",
      scheduled: "scheduled",
      open: "opened",
      closed: "closed",
      archived: "archived",
    };
    setMessage(`Enrolment period ${VERBS[status]}.`);
    fetchPeriods();
  };

  /* Only a window that never opened. The database enforces that — and that
     no enrolment is swept away with it — so this asks rather than decides. */
  const remove = async (p: EnrollmentPeriod) => {
    if (
      !window.confirm(
        `Delete "${p.title}"? This enrolment period has not opened, so no student has used it. It cannot be undone.`,
      )
    ) {
      return;
    }
    const { data, error } = await supabase.rpc("delete_enrollment_period", {
      p_period_id: p.id,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage((data as { message?: string })?.message ?? "Period removed.");
    fetchPeriods();
  };

  const toggleExpand = (periodId: string) =>
    setExpandedId((prev) => (prev === periodId ? null : periodId));

  const filteredPeriods = periods.filter((p) => {
    if (activeTab === "current") return p.status === "open";
    if (activeTab === "upcoming")
      return p.status === "draft" || p.status === "scheduled";
    if (activeTab === "closed") return p.status === "closed";
    return p.status === "archived";
  });

  /* A department admin landing on a tab that is no longer theirs. */
  useEffect(() => {
    if (!isSuperAdmin && activeTab === "upcoming") setActiveTab("current");
  }, [isSuperAdmin, activeTab]);

  const counts = {
    current: periods.filter((p) => p.status === "open").length,
    upcoming: periods.filter(
      (p) => p.status === "draft" || p.status === "scheduled",
    ).length,
    closed: periods.filter((p) => p.status === "closed").length,
    archived: periods.filter((p) => p.status === "archived").length,
  };

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Enrolment Periods
        </h1>
        <p className="text-muted-foreground text-sm">
          {isSuperAdmin
            ? "Open and close course enrolment windows for each batch."
            : "Enrolment windows are managed by the Super Admin. Shown read-only."}
        </p>
      </motion.div>

      {message && (
        <div className="p-3 rounded-xl bg-success-bg border border-success-border text-sm text-success-fg">
          {message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedTabs
          aria-label="Filter enrolment periods"
          value={activeTab}
          onChange={(v) => setActiveTab(v as TabValue)}
          layoutId="enrollment-period-tabs"
          scrollable
          tabs={TABS.map((t) => ({
            value: t.value,
            label: t.label,
            count: counts[t.value],
          }))}
        />
        {isSuperAdmin && !creating && !editingPeriod && (
          <Button
            onClick={() => setCreating(true)}
            className="bg-primary hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Enrolment Period
          </Button>
        )}
      </div>

      {(creating || editingPeriod) && (
        <PeriodForm
          adminId={admin?.id ?? ""}
          editing={editingPeriod}
          existingPeriods={periods}
          onSaved={(msg) => {
            setCreating(false);
            setEditingPeriod(null);
            setMessage(msg);
            fetchPeriods();
          }}
          onCancel={() => {
            setCreating(false);
            setEditingPeriod(null);
          }}
        />
      )}

      {loading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : filteredPeriods.length === 0 ? (
        <div className="text-center py-16">
          <GraduationCap className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No {activeTab} enrolment periods
          </h3>
          <p className="text-muted-foreground text-sm">
            {activeTab === "current"
              ? "Students cannot enrol until a period is opened."
              : "Nothing to show in this view yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPeriods.map((p) => (
            <Card key={p.id} className={`border-border ${departmentStripeClass(p.department)}`}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">
                        {p.title}
                      </span>
                      <Badge className={STATUS_COLOR[p.status]}>
                        {p.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.department ?? "All Departments"} ·{" "}
                      {p.batch_year !== null
                        ? describeBatch(p.batch_year)
                        : "Repeat students only"}{" "}
                      · Sem {p.semester} · {p.academic_year}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(p.opens_at)} →{" "}
                      {formatDateTime(p.closes_at)}
                    </p>
                    {p.instructions && (
                      <p className="text-xs text-foreground mt-1 max-w-md">
                        {p.instructions}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      {p.enrolledCount ?? 0} / {p.eligibleCount ?? 0} enrolled
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleExpand(p.id)}
                    >
                      {expandedId === p.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                    {isSuperAdmin && (
                      <div className="flex items-center gap-1.5">
                        {(p.status === "draft" || p.status === "scheduled") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCreating(false);
                              setEditingPeriod(p);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            Edit
                          </Button>
                        )}
                        {p.status === "draft" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setStatus(p.id, "scheduled")}
                          >
                            <Calendar className="h-3.5 w-3.5 mr-1" />
                            Schedule
                          </Button>
                        )}
                        {p.status !== "open" && p.status !== "archived" && (
                          <Button
                            size="sm"
                            className="bg-[var(--success-600)] text-white hover:bg-[var(--success-700)]"
                            onClick={() => setStatus(p.id, "open")}
                          >
                            <PlayCircle className="h-3.5 w-3.5 mr-1" />
                            Open
                          </Button>
                        )}
                        {p.status === "open" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setStatus(p.id, "closed")}
                          >
                            <Lock className="h-3.5 w-3.5 mr-1" />
                            Close
                          </Button>
                        )}
                        {p.status === "closed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setStatus(p.id, "archived")}
                          >
                            <Archive className="h-3.5 w-3.5 mr-1" />
                            Archive
                          </Button>
                        )}
                        {/* A window that has opened is a record of what
                            students were offered, so it is archived, never
                            deleted. One that never opened is just a mistake. */}
                        {(p.status === "draft" || p.status === "scheduled") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-danger-fg hover:text-danger-fg"
                            onClick={() => remove(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {expandedId === p.id && (
                  <div className="pt-2 border-t border-border/70">
                    <PeriodCourseBreakdown
                      periodId={p.id}
                      batchYear={p.batch_year}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PeriodForm({
  adminId,
  editing,
  existingPeriods,
  onSaved,
  onCancel,
}: {
  adminId: string;
  editing: EnrollmentPeriod | null;
  existingPeriods: EnrollmentPeriod[];
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [title, setTitle] = useState(editing?.title ?? "");
  const [academicYear, setAcademicYear] = useState(
    editing?.academic_year ??
      `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`,
  );
  const [semester, setSemester] = useState(editing?.semester ?? 1);
  /* Derived, never chosen — see the effect below. Null means no batch is in
     this semester, which makes the window a repeat-only one. */
  const [batchYear, setBatchYear] = useState<number | null>(
    editing?.batch_year ?? null,
  );
  const [batchResolved, setBatchResolved] = useState(false);
  const [department, setDepartment] = useState(editing?.department ?? "");
  const [opensAt, setOpensAt] = useState(
    editing ? toLocalInput(editing.opens_at) : "",
  );
  const [closesAt, setClosesAt] = useState(
    editing ? toLocalInput(editing.closes_at) : "",
  );
  const [instructions, setInstructions] = useState(
    editing?.instructions ?? "",
  );
  const [allCourses, setAllCourses] = useState<CourseOption[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [capacities, setCapacities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const settings = useSettings();
  const DEPARTMENTS = settings.studentDepartments;

  /* Naming the semester is the whole decision. Which batch is in that semester
     follows from the results already published, so asking the admin to pick a
     batch as well was asking them to restate something the system knows — and
     to get it wrong, which is how a Semester 2 window came to be aimed at a
     batch sitting Semester 7. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("batch_currently_in_semester", {
        p_semester: semester,
      });
      if (cancelled) return;
      setBatchYear((data as number | null) ?? null);
      setBatchResolved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [semester]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("courses")
        .select("id, course_code, title, semester, department")
        .order("course_code");
      setAllCourses(
        (data ?? []).map((c: any) => ({
          id: c.id,
          code: c.course_code,
          title: c.title,
          semester: c.semester,
          department: c.department,
        })),
      );
    })();

    if (editing) {
      (async () => {
        const { data } = await supabase
          .from("enrollment_period_courses")
          .select("course_id, capacity")
          .eq("period_id", editing.id);
        setSelectedCourseIds((data ?? []).map((r: any) => r.course_id));
        const capMap: Record<string, string> = {};
        (data ?? []).forEach((r: any) => {
          if (r.capacity !== null) capMap[r.course_id] = String(r.capacity);
        });
        setCapacities(capMap);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCourse = (id: string) => {
    setSelectedCourseIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const findConflict = () => {
    return existingPeriods.find(
      (p) =>
        p.id !== editing?.id &&
        (p.status === "scheduled" || p.status === "open") &&
        p.academic_year === academicYear &&
        p.semester === semester &&
        (p.department === (department || null) ||
          p.department === null ||
          department === ""),
    );
  };

  const handleSubmit = async () => {
    setError(null);
    if (!title || !opensAt || !closesAt) {
      setError("Please fill in all fields.");
      return;
    }
    if (new Date(closesAt) <= new Date(opensAt)) {
      setError("Closing date must be after the opening date.");
      return;
    }

    const conflict = findConflict();
    if (conflict && !conflictAcknowledged) {
      setError(
        `"${conflict.title}" is already ${conflict.status} for this semester and year. Click again to create anyway.`,
      );
      setConflictAcknowledged(true);
      return;
    }

    setSaving(true);

    const payload = {
      title,
      academic_year: academicYear,
      semester,
      batch_year: batchYear,
      department: department || null,
      opens_at: new Date(opensAt).toISOString(),
      closes_at: new Date(closesAt).toISOString(),
      instructions: instructions || null,
    };

    let periodId = editing?.id;
    if (editing) {
      const { error: updateError } = await supabase
        .from("enrollment_periods")
        .update(payload)
        .eq("id", editing.id);
      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("enrollment_periods")
        .insert({ ...payload, status: "draft", created_by: adminId })
        .select("id")
        .single();
      if (insertError || !inserted) {
        setError(insertError?.message ?? "Could not create the period.");
        setSaving(false);
        return;
      }
      periodId = inserted.id;
    }

    if (periodId) {
      // Replace the course list wholesale — simplest correct approach for a
      // form that's editing the whole set at once.
      await supabase
        .from("enrollment_period_courses")
        .delete()
        .eq("period_id", periodId);
      if (selectedCourseIds.length > 0) {
        const { error: coursesError } = await supabase
          .from("enrollment_period_courses")
          .insert(
            selectedCourseIds.map((course_id) => ({
              period_id: periodId,
              course_id,
              capacity: capacities[course_id]
                ? Number(capacities[course_id])
                : null,
            })),
          );
        if (coursesError) {
          setError(
            `Period saved, but courses could not be attached: ${coursesError.message}`,
          );
          setSaving(false);
          return;
        }
      }
    }

    setSaving(false);
    onSaved(
      editing ? "Enrolment period updated." : "Enrolment period created as a draft.",
    );
  };

  const semesterCourses = allCourses.filter(
    (c) =>
      c.semester === semester && (!department || c.department === department),
  );

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? "Edit Enrolment Period" : "New Enrolment Period"}
        </CardTitle>
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
              placeholder="e.g. Semester 7 Enrolment"
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
            <div className="w-full min-h-9 px-3 py-2 rounded-xl border border-border bg-muted/40 text-sm text-foreground">
              {!batchResolved
                ? "Working it out…"
                : batchYear !== null
                  ? describeBatch(batchYear)
                  : "No batch is in this semester"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {batchYear !== null
                ? "Whichever batch is in this semester now — worked out from published results."
                : `No batch is currently studying Semester ${semester}. Only students repeating a Semester ${semester} module will see this window.`}
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Department
            </label>
            <DepartmentSelect
              value={department}
              onChange={setDepartment}
              departments={DEPARTMENTS}
              allLabel="All Departments"
            />
          </div>
          <div />
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

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Instructions (optional)
          </label>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Anything students should know before enrolling in this window..."
            rows={2}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Included Courses (optional — leave empty to cover every Semester{" "}
            {semester}
            {department ? ` ${department}` : ""} course)
          </label>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left text-sm"
              >
                <span
                  className={
                    selectedCourseIds.length
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {selectedCourseIds.length === 0
                    ? "All matching courses"
                    : `${selectedCourseIds.length} course${selectedCourseIds.length !== 1 ? "s" : ""} selected`}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(28rem,90vw)] p-0">
              <Command>
                <CommandInput placeholder="Search by course code or name..." />
                <CommandList>
                  <CommandEmpty>
                    No courses found for Semester {semester}.
                  </CommandEmpty>
                  <CommandGroup>
                    {semesterCourses.map((c) => {
                      const isSelected = selectedCourseIds.includes(c.id);
                      return (
                        <CommandItem
                          key={c.id}
                          value={`${c.code} ${c.title}`}
                          onSelect={() => toggleCourse(c.id)}
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
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {selectedCourseIds.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {selectedCourseIds.map((id) => {
                const course = allCourses.find((c) => c.id === id);
                if (!course) return null;
                return (
                  <div key={id} className="flex items-center gap-2 text-xs">
                    <CourseCode code={course.code} className="text-sm flex-shrink-0" />
                    <span className="text-muted-foreground truncate flex-1">
                      {course.title}
                    </span>
                    <Input
                      type="number"
                      min="0"
                      placeholder="No cap"
                      value={capacities[id] ?? ""}
                      onChange={(e) =>
                        setCapacities((prev) => ({
                          ...prev,
                          [id]: e.target.value,
                        }))
                      }
                      className="h-7 w-24 text-xs"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving
              ? "Saving..."
              : conflictAcknowledged
                ? "Create Anyway"
                : editing
                  ? "Save Changes"
                  : "Create as Draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
