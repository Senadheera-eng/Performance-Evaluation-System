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
import { SegmentedTabs } from "../../components/common";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { useSettings } from "../../../lib/settings";

type PeriodStatus = "draft" | "scheduled" | "open" | "closed" | "archived";

const STATUS_COLOR: Record<PeriodStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-blue-100 text-blue-700",
  open: "bg-green-100 text-green-700",
  closed: "bg-amber-100 text-amber-700",
  archived: "bg-slate-200 text-slate-600",
};

interface EnrollmentPeriod {
  id: string;
  title: string;
  academic_year: string;
  semester: number;
  batch_year: number;
  department: string | null;
  opens_at: string;
  closes_at: string;
  status: PeriodStatus;
  instructions: string | null;
  eligibleCount?: number;
  enrolledCount?: number;
}

interface CourseStat {
  course_id: string;
  course_code: string;
  course_title: string;
  capacity: number | null;
  enrolled_count: number;
}

interface CourseOption {
  id: string;
  code: string;
  title: string;
  semester: number;
  department: string;
}

const TABS = [
  { value: "current", label: "Current" },
  { value: "upcoming", label: "Upcoming" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [courseStats, setCourseStats] = useState<
    Record<string, CourseStat[]>
  >({});
  const [courseStatsLoading, setCourseStatsLoading] = useState<string | null>(
    null,
  );

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

  const toggleExpand = async (period: EnrollmentPeriod) => {
    if (expandedId === period.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(period.id);
    if (!courseStats[period.id]) {
      setCourseStatsLoading(period.id);
      const { data, error } = await supabase.rpc(
        "get_enrollment_period_course_stats",
        { p_period_id: period.id },
      );
      if (error) {
        console.error("[AdminEnrollment] failed to load course stats", error);
      } else {
        setCourseStats((prev) => ({ ...prev, [period.id]: data ?? [] }));
      }
      setCourseStatsLoading(null);
    }
  };

  const filteredPeriods = periods.filter((p) => {
    if (activeTab === "current") return p.status === "open";
    if (activeTab === "upcoming")
      return p.status === "draft" || p.status === "scheduled";
    if (activeTab === "closed") return p.status === "closed";
    return p.status === "archived";
  });

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
        <div className="p-3 rounded-xl bg-green-50 border border-green-200 text-sm text-green-800">
          {message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedTabs
          aria-label="Filter enrolment periods"
          value={activeTab}
          onChange={(v) => setActiveTab(v as TabValue)}
          layoutId="enrollment-period-tabs"
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
            <Card key={p.id} className="border-border">
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
                      {describeBatch(p.batch_year)} · Sem {p.semester} ·{" "}
                      {p.academic_year}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.opens_at).toLocaleString()} →{" "}
                      {new Date(p.closes_at).toLocaleString()}
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
                      onClick={() => toggleExpand(p)}
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
                            className="bg-green-600 hover:bg-green-700"
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
                      </div>
                    )}
                  </div>
                </div>

                {expandedId === p.id && (
                  <div className="pt-2 border-t border-border/70">
                    {courseStatsLoading === p.id ? (
                      <div className="h-16 rounded-lg bg-muted animate-pulse" />
                    ) : (courseStats[p.id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        No courses match this period's semester.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pt-2">
                        {courseStats[p.id].map((c) => (
                          <div
                            key={c.course_id}
                            className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-muted/50"
                          >
                            <span className="text-foreground font-medium truncate">
                              {c.course_code}
                            </span>
                            <span className="text-muted-foreground tabular-nums flex-shrink-0 ml-2">
                              {c.enrolled_count}
                              {c.capacity !== null ? ` / ${c.capacity}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
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
  const [batchYear, setBatchYear] = useState<number | "">(
    editing?.batch_year ?? "",
  );
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
  const [batches, setBatches] = useState<number[]>([]);
  const [allCourses, setAllCourses] = useState<CourseOption[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [capacities, setCapacities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const settings = useSettings();
  const DEPARTMENTS = settings.studentDepartments;

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
      if (!editing && distinct.length > 0) setBatchYear(distinct[0]);
    })();

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
        p.batch_year === Number(batchYear) &&
        p.academic_year === academicYear &&
        p.semester === semester &&
        (p.department === (department || null) ||
          p.department === null ||
          department === ""),
    );
  };

  const handleSubmit = async () => {
    setError(null);
    if (!title || !batchYear || !opensAt || !closesAt) {
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
        `"${conflict.title}" is already ${conflict.status} for this batch, semester and year. Click again to create anyway.`,
      );
      setConflictAcknowledged(true);
      return;
    }

    setSaving(true);

    const payload = {
      title,
      academic_year: academicYear,
      semester,
      batch_year: Number(batchYear),
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
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Department
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm"
            >
              <option value="">All Departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
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
                    <Badge className="bg-primary/10 text-primary flex-shrink-0">
                      {course.code}
                    </Badge>
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
