import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Pencil, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  CourseCode,
  DepartmentName,
  EmptyState,
  ErrorState,
  PersonAvatar,
  SearchField,
  SectionCard,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "../common";
import { supabase } from "../../../lib/supabase";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";
import { semesterGpa } from "../../../lib/resultChanges";
import { EditResultDialog, type EditableResult } from "./EditResultDialog";

interface FoundStudent {
  id: string;
  name: string;
  reg_number: string | null;
  index_number: string | null;
  department: string | null;
  batch_year: number | null;
}

interface StudentResultRow {
  id: string;
  academicYear: string;
  midSem: number | null;
  ca: number | null;
  grade: string | null;
  gpv: number | null;
  status: "draft" | "submitted" | "published";
  originalGrade: string | null;
  code: string;
  title: string;
  semester: number;
  credits: number;
  department: string;
  contributesToGpa: boolean;
  changes: number;
}

const gradeTone = (grade: string | null): StatusTone => {
  if (!grade) return "neutral";
  if (grade.startsWith("A")) return "success";
  if (grade.startsWith("B")) return "info";
  if (grade.startsWith("C")) return "warning";
  return "danger";
};

const STATUS_LABEL: Record<StudentResultRow["status"], { label: string; tone: StatusTone }> = {
  published: { label: "Published", tone: "success" },
  submitted: { label: "In review", tone: "warning" },
  draft: { label: "Draft", tone: "neutral" },
};

/** PostgREST's or() filter reads commas and brackets as syntax. */
const searchable = (q: string) => q.replace(/[,()%*\\]/g, " ").trim();

const fmt = (n: number | null) => (n === null ? "—" : String(n));

/**
 * One student's results, semester by semester, for the Super Admin.
 *
 * Find a student by name, registration or index number, see every result
 * they have with each semester's GPA, and change any published one. The
 * change goes through the same recorded, reasoned route as on a course's
 * sheet (change_published_result), and the student is told.
 */
export function StudentResultsPanel({ initialStudentId }: { initialStudentId?: string | null }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundStudent[]>([]);
  const [searching, setSearching] = useState(false);
  const [student, setStudent] = useState<FoundStudent | null>(null);
  const [rows, setRows] = useState<StudentResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState<EditableResult | null>(null);

  /* Matches as the Super Admin types: names, registration and index numbers. */
  useEffect(() => {
    const q = searchable(query);
    if (q.length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from("students")
        .select("id, name, reg_number, index_number, department, batch_year")
        .eq("role", "student")
        .or(`name.ilike.%${q}%,reg_number.ilike.%${q}%,index_number.ilike.%${q}%`)
        .order("name")
        .limit(8);
      if (!live) return;
      setFound((data ?? []) as FoundStudent[]);
      setSearching(false);
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  /* Arriving from the Students page with a student already chosen. */
  useEffect(() => {
    if (!initialStudentId) return;
    supabase
      .from("students")
      .select("id, name, reg_number, index_number, department, batch_year")
      .eq("id", initialStudentId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setStudent(data as FoundStudent);
      });
  }, [initialStudentId]);

  const loadResults = useCallback(async (studentId: string) => {
    setLoading(true);
    setError(null);
    const [results, changes] = await Promise.all([
      supabase
        .from("results")
        .select(
          "id, academic_year, mid_sem_mark, ca_mark, grade, gpv, status, original_grade, courses(course_code, title, semester, credits, department, contributes_to_gpa)",
        )
        .eq("student_id", studentId),
      supabase.from("result_changes").select("result_id").eq("student_id", studentId),
    ]);
    if (results.error) {
      setError("This student's results could not be loaded.");
      setRows([]);
      setLoading(false);
      return;
    }
    const changeCount = new Map<string, number>();
    for (const c of changes.data ?? []) changeCount.set(c.result_id, (changeCount.get(c.result_id) ?? 0) + 1);

    const list: StudentResultRow[] = (results.data ?? []).map((r: any) => {
      const course = Array.isArray(r.courses) ? r.courses[0] : r.courses;
      return {
        id: r.id,
        academicYear: r.academic_year,
        midSem: r.mid_sem_mark,
        ca: r.ca_mark,
        grade: r.grade,
        gpv: r.gpv,
        status: r.status,
        originalGrade: r.original_grade,
        code: course?.course_code ?? "—",
        title: course?.title ?? "",
        semester: course?.semester ?? 0,
        credits: Number(course?.credits ?? 0),
        department: course?.department ?? "",
        contributesToGpa: course?.contributes_to_gpa ?? true,
        changes: changeCount.get(r.id) ?? 0,
      };
    });
    list.sort((a, b) => a.semester - b.semester || a.academicYear.localeCompare(b.academicYear) || a.code.localeCompare(b.code));
    setRows(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (student) loadResults(student.id);
    else setRows([]);
  }, [student, loadResults]);

  const semesters = useMemo(() => {
    const bySemester = new Map<number, StudentResultRow[]>();
    for (const r of rows) bySemester.set(r.semester, [...(bySemester.get(r.semester) ?? []), r]);
    return [...bySemester.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows]);

  const gpaRows = (list: StudentResultRow[]) =>
    list.map((r) => ({ gpv: r.gpv, credits: r.credits, contributesToGpa: r.contributesToGpa, published: r.status === "published" }));
  const cgpa = semesterGpa(gpaRows(rows));

  const choose = (s: FoundStudent) => {
    setStudent(s);
    setQuery("");
    setFound([]);
  };

  const openChange = (r: StudentResultRow) => {
    if (!student) return;
    setChanging({
      id: r.id,
      studentName: student.name,
      courseLabel: `${r.code} ${r.title}`,
      midSem: r.midSem,
      ca: r.ca,
      grade: r.grade,
      originalGrade: r.originalGrade,
    });
  };

  return (
    <div className="space-y-5">
      {/* Find the student. */}
      <SectionCard title={student ? "Student" : "Find a student"} bodyClassName="space-y-3">
        {student ? (
          <div className="flex flex-wrap items-center gap-3">
            <PersonAvatar name={student.name} department={student.department} size="md" />
            <div className="min-w-[12rem] flex-1">
              <p className="font-semibold text-foreground">{student.name}</p>
              <p className="text-sm text-muted-foreground">
                {student.index_number ?? "—"} · {formatRegNumber(student.reg_number)} ·{" "}
                <DepartmentName department={student.department ?? "No department yet"} />
                {student.batch_year ? ` · ${describeBatch(student.batch_year)}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">CGPA</p>
              <p className="text-xl font-bold tabular-nums text-foreground">{cgpa === null ? "—" : cgpa.toFixed(2)}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setStudent(null)}>
              <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Another student
            </Button>
          </div>
        ) : (
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Name, registration number or index number"
              label="Find a student"
            />
            {searchable(query).length >= 2 &&
              (searching && found.length === 0 ? (
                <SkeletonRows count={2} height="h-10" />
              ) : found.length === 0 ? (
                <p className="text-sm text-muted-foreground">No student matches “{query}”.</p>
              ) : (
                <ul className="divide-y divide-border rounded-control border border-border">
                  {found.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => choose(s)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                      >
                        <PersonAvatar name={s.name} department={s.department} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{s.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {s.index_number ?? "—"} · {formatRegNumber(s.reg_number)} ·{" "}
                            {s.department ?? "No department yet"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
            {searchable(query).length < 2 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                Type at least two letters or digits. You can change any published result, in any department's course.
              </p>
            )}
          </>
        )}
      </SectionCard>

      {student &&
        (error ? (
          <ErrorState message={error} onRetry={() => loadResults(student.id)} size="inline" />
        ) : loading ? (
          <SkeletonRows count={6} height="h-12" />
        ) : rows.length === 0 ? (
          <EmptyState icon={History} title="No results yet" description="This student has no results recorded." size="inline" />
        ) : (
          semesters.map(([semester, list]) => {
            const sgpa = semesterGpa(gpaRows(list));
            return (
              <SectionCard
                key={semester}
                flush
                title={semester > 0 ? `Semester ${semester}` : "Other"}
                actions={
                  <span className="text-sm text-muted-foreground">
                    SGPA{" "}
                    <strong className="tabular-nums text-foreground">{sgpa === null ? "—" : sgpa.toFixed(2)}</strong>
                  </span>
                }
              >
                <div
                  aria-hidden="true"
                  className="hidden grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_3.5rem_6rem_2.25rem] gap-x-3 border-b border-border/60 px-4 py-1.5 text-xs text-muted-foreground sm:grid"
                >
                  <span>Course</span>
                  <span className="text-center">Mid /50</span>
                  <span className="text-center">CA /50</span>
                  <span className="text-center">Grade</span>
                  <span className="text-center">Status</span>
                  <span />
                </div>
                <ul className="divide-y divide-border/60">
                  {list.map((r) => (
                    <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_3.5rem_6rem_2.25rem]">
                      <div className="min-w-0">
                        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-foreground">
                          <CourseCode code={r.code} />
                          <span className="min-w-0 truncate">{r.title}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.credits} credit{r.credits === 1 ? "" : "s"} · {r.academicYear}
                          {r.originalGrade && ` · re-sit after ${r.originalGrade}`}
                          {r.changes > 0 && ` · changed ${r.changes === 1 ? "once" : `${r.changes} times`}`}
                        </p>
                      </div>
                      <span className="hidden text-center text-sm tabular-nums text-muted-foreground sm:block" title="Mid Sem">
                        <span className="sr-only">Mid Sem </span>
                        {fmt(r.midSem)}
                      </span>
                      <span className="hidden text-center text-sm tabular-nums text-muted-foreground sm:block" title="CA">
                        <span className="sr-only">CA </span>
                        {fmt(r.ca)}
                      </span>
                      <span className="flex justify-end sm:justify-center">
                        {r.grade ? <StatusBadge tone={gradeTone(r.grade)}>{r.grade}</StatusBadge> : <span className="text-muted-foreground">—</span>}
                      </span>
                      <span className="hidden justify-center sm:flex">
                        <StatusBadge tone={STATUS_LABEL[r.status].tone}>{STATUS_LABEL[r.status].label}</StatusBadge>
                      </span>
                      <span className="flex justify-end">
                        {r.status === "published" ? (
                          <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Change this result" onClick={() => openChange(r)}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="sr-only">
                              Change {r.code} result
                            </span>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground sm:hidden">{STATUS_LABEL[r.status].label}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            );
          })
        ))}

      <EditResultDialog
        result={changing}
        onOpenChange={(open) => !open && setChanging(null)}
        onSaved={(message) => {
          setChanging(null);
          toast.success(message, { duration: 8_000 });
          if (student) loadResults(student.id);
        }}
      />
    </div>
  );
}
