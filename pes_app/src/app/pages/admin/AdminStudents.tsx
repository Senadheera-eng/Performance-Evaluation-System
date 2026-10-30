import { useState, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Users,
  GraduationCap,
  TrendingUp,
  Calendar,
  ChevronDown,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  DepartmentChips,
  DepartmentName,
  EmptyState,
  PageHeader,
  PersonAvatar,
  PillTabs,
  SearchField,
  SectionCard,
  SkeletonRows,
  StatStrip,
  StatusBadge,
  useExpandMotion,
} from "../../components/common";
import { useAvatarUrls } from "../../../lib/avatars";
import { ChangeBatchDialog } from "../../components/admin/ChangeBatchDialog";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { getAdminScope, describeAdminReach } from "../../../lib/adminScope";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";
import { cn } from "../../components/ui/utils";
import { departmentRowClass } from "../../../lib/departments";

/* A first-year is admitted to the faculty, not to a department, and is
   divided into one partway through. Until then students.department is null,
   and saying so is better than rendering a blank after the separator. */
const NO_DEPARTMENT_YET = "No department yet";

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
  const avatars = useAvatarUrls(students.map((st) => st.id));
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "cgpa" | "attendance">("name");
  const [batchFilter, setBatchFilter] = useState<number | "all">("all");
  /* The Super Admin sees every department at once; one at a time, from the
     department chips. A department admin's list is one department already. */
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const [movingStudent, setMovingStudent] = useState<{
    id: string;
    name: string;
    batchYear: number;
  } | null>(null);
  const reduce = useReducedMotion();
  const expand = useExpandMotion();

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
        department: s.department ?? NO_DEPARTMENT_YET,
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

  const inBatch =
    batchFilter === "all"
      ? students
      : students.filter((s) => s.batchYear === batchFilter);

  // Departments in this batch, largest first, with "No department yet" last.
  const deptCounts = new Map<string, number>();
  for (const s of inBatch) deptCounts.set(s.department, (deptCounts.get(s.department) ?? 0) + 1);
  const deptItems = [...deptCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) =>
      a.name === NO_DEPARTMENT_YET ? 1 : b.name === NO_DEPARTMENT_YET ? -1 : b.count - a.count,
    );

  const batchFiltered = deptFilter
    ? inBatch.filter((s) => s.department === deptFilter)
    : inBatch;

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

  const withCgpa = batchFiltered.filter((s) => s.cgpa !== null);
  const withAttendance = batchFiltered.filter((s) => s.hasAttendanceData);
  const avgCgpa =
    withCgpa.length > 0
      ? (withCgpa.reduce((sum, s) => sum + (s.cgpa ?? 0), 0) / withCgpa.length).toFixed(2)
      : "—";
  const avgAttendance =
    withAttendance.length > 0
      ? `${Math.round(withAttendance.reduce((sum, s) => sum + s.avgAttendance, 0) / withAttendance.length)}%`
      : "—";

  const toggle = (id: string) => setExpandedId(expandedId === id ? null : id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Student Management"
        description={
          scope.kind === "all"
            ? "View and manage all registered students and their academic records."
            : scope.department === "Interdisciplinary Studies"
              ? "Students with results or enrollments in an Interdisciplinary Studies course."
              : `Students in ${describeAdminReach(currentAdmin)}.`
        }
      />

      {/* The numbers for whatever the batch and department filters show */}
      {loading ? (
        <div className="flex gap-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-shimmer h-7 w-36 rounded-full bg-muted" />
          ))}
        </div>
      ) : (
        <StatStrip
          items={[
            { label: `student${batchFiltered.length === 1 ? "" : "s"}`, value: batchFiltered.length, icon: Users, tone: "brand" },
            { label: "average CGPA", value: avgCgpa, icon: TrendingUp, tone: "success" },
            { label: "average attendance", value: avgAttendance, icon: Calendar, tone: "info" },
          ]}
        />
      )}

      {/* One row of controls: search, batch, sort */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by name, reg number or email"
          label="Search students"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(batchFilter)}
            onValueChange={(v) => setBatchFilter(v === "all" ? "all" : Number(v))}
          >
            <SelectTrigger aria-label="Batch" className="h-9 w-52 rounded-control border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Batches</SelectItem>
              {batches.map((b) => (
                <SelectItem key={b} value={String(b)}>
                  {describeBatch(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PillTabs
            aria-label="Sort students by"
            layoutId="admin-students-sort"
            value={sortBy}
            onChange={(v) => setSortBy(v as "name" | "cgpa" | "attendance")}
            tabs={[
              { value: "name", label: "Name" },
              { value: "cgpa", label: "CGPA" },
              { value: "attendance", label: "Attendance" },
            ]}
          />
        </div>
      </div>

      {scope.kind === "all" && deptItems.length > 1 && (
        <DepartmentChips
          items={deptItems}
          value={deptFilter}
          onChange={setDeptFilter}
          total={inBatch.length}
          ariaLabel="Show students from"
        />
      )}

      {/* Student List */}
      <SectionCard
        title={
          <>
            Students{" "}
            <span className="text-sm font-normal text-muted-foreground">({filtered.length})</span>
          </>
        }
        // Visible overflow, so the column header can stay pinned.
        className="overflow-visible"
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={6} height="h-14" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Users} title="No students found." size="inline" />
          </div>
        ) : (
          <>
            {/* Column header, pinned under the top bar on a wide screen */}
            <div className="sticky top-14 z-10 hidden grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_5.5rem_7.5rem_1.5rem] items-center gap-3 border-b border-border/70 bg-card/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur-sm md:grid">
              <span>Student</span>
              <span className="text-center">CGPA</span>
              <span className="text-center">Attendance</span>
              <span className="text-center">Enrolled</span>
              <span />
              <span />
            </div>
            <ul className="divide-y divide-border/60">
              {filtered.map((student, index) => {
                const open = expandedId === student.id;
                const low = student.hasAttendanceData && student.avgAttendance < 80;
                return (
                  <motion.li
                    key={student.id}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: reduce ? 0 : Math.min(index * 0.02, 0.2) }}
                  >
                    {/* Opens with Enter or Space as well as a click: it was a
                        bare div, which a keyboard could not reach. */}
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      className={cn(
                        "grid cursor-pointer grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-3 border-l-4 px-4 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 md:grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_5.5rem_7.5rem_1.5rem]",
                        departmentRowClass(student.department),
                        open && "bg-muted/40",
                      )}
                      onClick={() => toggle(student.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(student.id);
                        }
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <PersonAvatar
                          name={student.name}
                          url={avatars[student.id]}
                          department={student.department}
                          className="h-9 w-9 text-sm"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{student.name}</p>
                          <p className="truncate text-sm text-muted-foreground">
                            {student.regNumber} · <DepartmentName department={student.department} />
                            {student.department === NO_DEPARTMENT_YET && (
                              <span className="ml-1 text-xs">(Super Admin holds their records)</span>
                            )}
                          </p>
                          {/* On a phone the figures fold under the name */}
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground md:hidden">
                            <span>
                              CGPA <strong className="text-foreground tabular-nums">{student.cgpa?.toFixed(2) ?? "—"}</strong>
                            </span>
                            <span>
                              Attendance{" "}
                              <strong
                                className={cn(
                                  "tabular-nums",
                                  !student.hasAttendanceData
                                    ? "text-muted-foreground"
                                    : student.avgAttendance >= 80
                                      ? "text-success-fg"
                                      : "text-danger-fg",
                                )}
                              >
                                {student.hasAttendanceData ? `${student.avgAttendance}%` : "—"}
                              </strong>
                            </span>
                            <span>
                              Enrolled <strong className="text-foreground tabular-nums">{student.enrolledCourses}</strong>
                            </span>
                            {low && <StatusBadge tone="danger">Low Attendance</StatusBadge>}
                          </p>
                        </div>
                      </div>
                      <span className="hidden text-center text-base font-bold tabular-nums text-foreground md:block">
                        {student.cgpa?.toFixed(2) ?? "—"}
                      </span>
                      <span
                        className={cn(
                          "hidden text-center text-base font-bold tabular-nums md:block",
                          !student.hasAttendanceData
                            ? "text-muted-foreground"
                            : student.avgAttendance >= 80
                              ? "text-success-fg"
                              : "text-danger-fg",
                        )}
                      >
                        {student.hasAttendanceData ? `${student.avgAttendance}%` : "—"}
                      </span>
                      <span className="hidden text-center text-base font-bold tabular-nums text-foreground md:block">
                        {student.enrolledCourses}
                      </span>
                      <span className="hidden justify-end md:flex">
                        {low && <StatusBadge tone="danger">Low Attendance</StatusBadge>}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-5 w-5 text-muted-foreground transition-transform duration-200",
                          open && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                    </div>

                    {/* Expanded Details */}
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          key="details"
                          variants={expand}
                          initial="collapsed"
                          animate="open"
                          exit="collapsed"
                          className="overflow-hidden"
                        >
                          <div className="border-t border-border/60 bg-muted/30 px-4 py-3 sm:pl-16">
                            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              {(
                                [
                                  [Mail, "Email", student.email],
                                  [Calendar, "Batch", `${student.batchYear}/${student.batchYear + 1}`],
                                  [GraduationCap, "Credits Earned", String(student.totalCredits)],
                                  [TrendingUp, "CGPA", student.cgpa?.toFixed(2) ?? "No results yet"],
                                ] as const
                              ).map(([Icon, label, value]) => (
                                <div key={label} className="flex min-w-0 items-center gap-2">
                                  <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                                  <div className="min-w-0">
                                    <dt className="text-xs text-muted-foreground">{label}</dt>
                                    <dd className="truncate text-sm font-medium text-foreground">{value}</dd>
                                  </div>
                                </div>
                              ))}
                            </dl>

                            {/* Repeating a year moves a student to a later intake.
                                The change is recorded with a reason and who made
                                it — the database refuses any other route. */}
                            <div className="mt-3 flex justify-end border-t border-border/70 pt-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setMovingStudent({
                                    id: student.id,
                                    name: student.name,
                                    batchYear: student.batchYear,
                                  })
                                }
                              >
                                <Calendar className="mr-1.5 h-3.5 w-3.5" />
                                Change intake
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </ul>
          </>
        )}
      </SectionCard>

      <ChangeBatchDialog
        open={movingStudent !== null}
        onOpenChange={(open) => !open && setMovingStudent(null)}
        student={movingStudent}
        batches={batches}
        onChanged={(message) => {
          setMovingStudent(null);
          toast.success(message);
          fetchStudents();
        }}
      />
    </div>
  );
}
