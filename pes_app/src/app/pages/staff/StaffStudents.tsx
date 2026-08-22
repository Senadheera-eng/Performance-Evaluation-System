import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";
import { Input } from "../../components/ui/input";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  StatCard,
  StatusBadge,
  type StatusTone,
} from "../../components/common";
import { useAuth } from "../../context/AuthContext";
import { getStaffCapabilities } from "../../../lib/staffScope";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";
import { useSettings } from "../../../lib/settings";
import {
  getDepartmentStudents,
  getStudentAcademicRecord,
  type DepartmentStudent,
  type StudentRecordRow,
} from "../../../lib/staffService";

const gradeTone = (grade: string | null): StatusTone => {
  if (!grade) return "neutral";
  const g = grade.toUpperCase();
  if (g.startsWith("A")) return "success";
  if (g.startsWith("B")) return "info";
  if (g.startsWith("C") || g.startsWith("D")) return "warning";
  return "danger";
};

/**
 * Department students, for a head of department.
 *
 * This is the oversight half of the appointment: a lecturer sees the roster
 * of a course they teach, a head sees every student the department is
 * responsible for and their whole record. Both are resolved server-side —
 * `students` grants a lecturer nothing directly, and the record RPC refuses
 * any student outside the caller's own department.
 */
export default function StaffStudents() {
  const { staff } = useAuth();
  const settings = useSettings();
  const caps = getStaffCapabilities(staff);

  const [students, setStudents] = useState<DepartmentStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"index" | "cgpa">("index");

  const [expanded, setExpanded] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, StudentRecordRow[]>>({});
  const [recordLoading, setRecordLoading] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (staff) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await getDepartmentStudents();
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setStudents(result.data);
    setLoading(false);
  };

  const toggle = async (studentId: string) => {
    if (expanded === studentId) {
      setExpanded(null);
      return;
    }
    setExpanded(studentId);
    if (records[studentId]) return;

    setRecordLoading(studentId);
    setRecordError((prev) => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
    const result = await getStudentAcademicRecord(studentId);
    if (!result.ok) {
      setRecordError((prev) => ({
        ...prev,
        [studentId]: "Unable to load this student's record.",
      }));
    } else {
      setRecords((prev) => ({ ...prev, [studentId]: result.data }));
    }
    setRecordLoading(null);
  };

  const batches = useMemo(
    () => [...new Set(students.map((s) => s.batch_year))].sort((a, b) => b - a),
    [students],
  );

  const visible = useMemo(() => {
    const q = query.toLowerCase();
    return students
      .filter((s) => batchFilter === "all" || s.batch_year === Number(batchFilter))
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.index_number ?? "").toLowerCase().includes(q) ||
          (s.reg_number ?? "").toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q),
      )
      .sort((a, b) =>
        sortBy === "cgpa"
          ? (b.cgpa ?? -1) - (a.cgpa ?? -1)
          : (a.index_number ?? "").localeCompare(b.index_number ?? ""),
      );
  }, [students, query, batchFilter, sortBy]);

  const withCgpa = visible.filter((s) => s.cgpa !== null);
  const avgCgpa =
    withCgpa.length > 0
      ? (withCgpa.reduce((sum, s) => sum + (s.cgpa ?? 0), 0) / withCgpa.length).toFixed(2)
      : "—";
  // Below the pass classification: the students a head of department most
  // needs to see, and the trigger for the repeat-year conversation.
  const atRisk = withCgpa.filter((s) => (s.cgpa ?? 0) < 2.0).length;

  if (!caps.isHod) {
    return (
      <div className="space-y-5">
        <PageHeader title="Department Students" />
        <EmptyState
          icon={Users}
          title="Only the Head of Department can see department-wide student records"
          description="Your own courses and their rosters are under My Courses."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Department Students"
        description={`Every student in ${caps.hodDepartment}, with their full semester-by-semester record.`}
      />

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} label="Students" value={visible.length} icon={Users} tone="brand" />
        <StatCard index={1} label="Average CGPA" value={avgCgpa} icon={TrendingUp} tone="info" />
        <StatCard
          index={2}
          label="Below Pass (2.00)"
          value={atRisk}
          icon={GraduationCap}
          tone={atRisk > 0 ? "danger" : "success"}
          hint="May need to repeat a year"
        />
        <StatCard
          index={3}
          label="No Results Yet"
          value={visible.length - withCgpa.length}
          icon={GraduationCap}
          tone="neutral"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, index no., reg no. or email..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 bg-card pl-9"
          />
        </div>
        <SegmentedTabs
          aria-label="Sort students"
          value={sortBy}
          onChange={(v) => setSortBy(v as "index" | "cgpa")}
          layoutId="staff-students-sort"
          tabs={[
            { value: "index", label: "Index No." },
            { value: "cgpa", label: "CGPA" },
          ]}
        />
      </div>

      {/* Shown from the first batch, not the second. Results and Attendance
          carry a Batch control whatever is on record, and a department that
          finds one here and not there reads it as the filter being missing. */}
      {batches.length > 0 && (
        <SegmentedTabs
          aria-label="Filter by batch"
          value={batchFilter}
          onChange={setBatchFilter}
          layoutId="staff-students-batch"
          scrollable
          tabs={[
            { value: "all", label: "All", count: students.length },
            ...batches.map((b) => ({
              value: String(b),
              label: describeBatch(b).replace(/ \(.*\)$/, ""),
              count: students.filter((s) => s.batch_year === b).length,
            })),
          ]}
        />
      )}

      <SectionCard title="Students" description={`${visible.length} shown`} flush>
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={8} height="h-14" />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Users} title="No students match this filter" />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {visible.map((s) => (
              <li key={s.student_id}>
                <button
                  type="button"
                  onClick={() => toggle(s.student_id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {expanded === s.student_id ? (
                      <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.index_number ?? "—"} · {formatRegNumber(s.reg_number)} ·{" "}
                        {describeBatch(s.batch_year)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-4">
                    <div className="text-right">
                      <p
                        className={`text-sm font-semibold tabular-nums ${
                          s.cgpa === null
                            ? "text-muted-foreground"
                            : s.cgpa < 2.0
                              ? "text-danger-fg"
                              : "text-foreground"
                        }`}
                      >
                        {s.cgpa?.toFixed(2) ?? "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">CGPA</p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {s.gpa_credits}
                      </p>
                      <p className="text-[11px] text-muted-foreground">credits</p>
                    </div>
                  </div>
                </button>

                {expanded === s.student_id && (
                  <div className="border-t border-border/70 bg-muted/20 px-4 py-3">
                    {recordLoading === s.student_id ? (
                      <SkeletonRows count={3} height="h-8" />
                    ) : recordError[s.student_id] ? (
                      <ErrorState
                        message={recordError[s.student_id]}
                        onRetry={() => toggle(s.student_id)}
                        size="inline"
                      />
                    ) : (
                      <SemesterRecord
                        rows={records[s.student_id] ?? []}
                        gpvScaleMax={4}
                        totalCredits={settings.graduationTotalCredits}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function SemesterRecord({
  rows,
  gpvScaleMax,
  totalCredits,
}: {
  rows: StudentRecordRow[];
  gpvScaleMax: number;
  totalCredits: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-1 text-xs text-muted-foreground">
        No published results for this student yet.
      </p>
    );
  }

  const bySemester = new Map<number, StudentRecordRow[]>();
  for (const r of rows) {
    const list = bySemester.get(r.semester) ?? [];
    list.push(r);
    bySemester.set(r.semester, list);
  }

  const earned = rows
    .filter((r) => r.contributes_to_gpa && r.gpv !== null)
    .reduce((sum, r) => sum + r.credits, 0);

  // Whether any component marks exist at all: the historical import carries
  // grades only, so four permanently empty columns would just look broken.
  const hasComponents = rows.some(
    (r) => r.mid_sem_mark !== null || r.ca_mark !== null || r.ese_mark !== null,
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {earned} of {totalCredits} GPA credits earned across{" "}
        {bySemester.size} semester{bySemester.size === 1 ? "" : "s"}.
      </p>

      {[...bySemester.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([semester, courses]) => {
          const gpaCourses = courses.filter(
            (c) => c.contributes_to_gpa && c.gpv !== null,
          );
          const credits = gpaCourses.reduce((sum, c) => sum + c.credits, 0);
          const weighted = gpaCourses.reduce(
            (sum, c) => sum + (c.gpv ?? 0) * c.credits,
            0,
          );
          const sgpa = credits > 0 ? weighted / credits : null;

          return (
            <div key={semester}>
              <div className="mb-1 flex items-center gap-2">
                <h4 className="text-xs font-semibold text-foreground">
                  Semester {semester}
                </h4>
                <span className="text-xs text-muted-foreground">
                  {courses[0].academic_year}
                </span>
                {sgpa !== null && (
                  <StatusBadge tone={sgpa >= 2 ? "info" : "danger"}>
                    SGPA {sgpa.toFixed(2)} / {gpvScaleMax.toFixed(2)}
                  </StatusBadge>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="pb-1 pr-3 font-medium">Course</th>
                      <th className="pb-1 pr-3 font-medium">Cr</th>
                      {hasComponents && (
                        <>
                          <th className="pb-1 pr-3 font-medium">Mid</th>
                          <th className="pb-1 pr-3 font-medium">CA</th>
                          <th className="pb-1 pr-3 font-medium">ESE</th>
                          <th className="pb-1 pr-3 font-medium">OA</th>
                        </>
                      )}
                      <th className="pb-1 pr-3 font-medium">Grade</th>
                      <th className="pb-1 font-medium">GPV</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {courses.map((c) => (
                      <tr key={c.course_code}>
                        <td className="py-1 pr-3">
                          <span className="font-medium text-primary">
                            {c.course_code}
                          </span>{" "}
                          <span className="text-muted-foreground">{c.course_title}</span>
                          {!c.contributes_to_gpa && (
                            <span className="ml-1 text-muted-foreground">(non-GPA)</span>
                          )}
                        </td>
                        <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                          {c.credits}
                        </td>
                        {hasComponents && (
                          <>
                            <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                              {c.mid_sem_mark ?? "—"}
                            </td>
                            <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                              {c.ca_mark ?? "—"}
                            </td>
                            <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                              {c.ese_mark ?? "—"}
                            </td>
                            <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                              {c.oa_mark?.toFixed(1) ?? "—"}
                            </td>
                          </>
                        )}
                        <td className="py-1 pr-3">
                          {c.grade ? (
                            <StatusBadge tone={gradeTone(c.grade)}>{c.grade}</StatusBadge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-1 tabular-nums text-muted-foreground">
                          {c.gpv?.toFixed(2) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
    </div>
  );
}
