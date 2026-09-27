import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Award,
  BookOpenCheck,
  Download,
  GraduationCap,
  Loader2,
  Megaphone,
  TrendingUp,
} from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  ChartContainer,
  ChartTooltip,
  EmptyState,
  GpaTrendChart,
  ErrorState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  Skeleton,
  SkeletonRows,
  StatCard,
  StatusBadge,
  useChartMotion,
  type StatusTone,
} from "../components/common";
import { cn } from "../components/ui/utils";
import { supabase } from "../../lib/supabase";
import { departmentByCourseCode } from "../../lib/departments";
import { useAuth } from "../context/AuthContext";
import { describeBatch } from "../../lib/batch";
import { useSettings } from "../../lib/settings";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface CourseResult {
  code: string;
  name: string;
  credits: number;
  // No marks at all, only the grade: the student-facing record withholds
  // ESE and OA, and does not carry mid-semester or CA marks either.
  grade: string | null;
  gpv: number | null;
  contributes_to_gpa: boolean;
  /** Set only for a course sat more than once. */
  attempt?: { number: number; academicYear: string; isLatest: boolean };
}

interface SemesterData {
  semesterKey: string;
  label: string;
  academicYear: string;
  semesterNum: number;
  courses: CourseResult[];
  /**
   * Null until the semester is finished. A published course result is a fact
   * the moment it lands; an SGPA computed from a third of the marks is not
   * one, so it waits for the rest.
   */
  sgpa: number | null;
  totalCredits: number;
  /** Every course the student is enrolled in this semester has a result. */
  complete: boolean;
  enrolled: number;
  published: number;
}

interface GpaChartPoint {
  semester: string;
  semesterNum: number;
  gpa: number;
}

interface GradeCount {
  grade: string;
  count: number;
  gpv: number;
}

/**
 * Grade tone. Uses semantic status tokens rather than literal Tailwind
 * colours so grades stay legible in dark mode.
 */
const gradeTone = (grade: string | null): StatusTone => {
  if (!grade) return "neutral";
  const g = grade.toUpperCase();
  if (g.startsWith("A")) return "success";
  if (g.startsWith("B")) return "info";
  if (g.startsWith("C") || g.startsWith("D")) return "warning";
  if (g === "F" || g === "R") return "danger";
  return "neutral";
};

const TONE_VAR: Record<StatusTone, string> = {
  success: "var(--status-success-fg)",
  warning: "var(--status-warning-fg)",
  danger: "var(--status-danger-fg)",
  info: "var(--status-info-fg)",
  neutral: "var(--status-neutral-fg)",
  brand: "var(--primary)",
};

export default function Results() {
  const { student } = useAuth();
  const settings = useSettings();
  const chartDuration = useChartMotion();

  const [semesters, setSemesters] = useState<SemesterData[]>([]);
  const [activeSemesterTab, setActiveSemesterTab] = useState<string>("");
  const [gpaChart, setGpaChart] = useState<GpaChartPoint[]>([]);
  const [gradeSpread, setGradeSpread] = useState<GradeCount[]>([]);
  const [cgpa, setCgpa] = useState<number>(0);
  const [totalCredits, setTotalCredits] = useState<number>(0);
  const [completedCourses, setCompletedCourses] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!student?.id) return;
    fetchResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  /**
   * The whole record, from one call.
   *
   * This used to read the published rows and infer the shape of the degree
   * from them, so a semester existed only once it had a result in it and
   * looked finished the moment its first one arrived. The database decides
   * both now: eight semesters always, each one saying whether it is done.
   */
  const fetchResults = async () => {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase.rpc(
      "get_my_academic_record",
    );

    if (queryError || !data) {
      console.error("[Results] failed to load results", queryError);
      setError("We could not load your results. Please try again.");
      setLoading(false);
      return;
    }

    const record = data as {
      cgpa: number | null;
      gpa_credits: number;
      semesters: {
        semester: number;
        academic_year: string;
        enrolled: number;
        published: number;
        complete: boolean;
        gpa_credits: number;
        sgpa: number | null;
        courses: {
          course_code: string;
          title: string;
          credits: number;
          grade: string | null;
          gpv: number | null;
          contributes_to_gpa: boolean;
          academic_year: string;
          attempt_number: number;
          has_repeat: boolean;
          is_latest_attempt: boolean;
        }[];
      }[];
    };

    const semList: SemesterData[] = record.semesters.map((s) => ({
      semesterKey: `sem_${s.semester}`,
      label: `Semester ${s.semester}`,
      academicYear: s.academic_year,
      semesterNum: s.semester,
      complete: s.complete,
      enrolled: s.enrolled,
      published: s.published,
      sgpa: s.sgpa,
      totalCredits: s.gpa_credits,
      courses: s.courses.map((c) => ({
        code: c.course_code,
        name: c.title,
        credits: c.credits,
        grade: c.grade,
        gpv: c.gpv,
        contributes_to_gpa: c.contributes_to_gpa,
        attempt: c.has_repeat
          ? {
              number: c.attempt_number,
              academicYear: c.academic_year,
              isLatest: c.is_latest_attempt,
            }
          : undefined,
      })),
    }));

    setSemesters(semList);

    // Open on the semester the student came to look at: the newest one that
    // has anything in it, rather than the newest empty one.
    const withContent = semList.filter((s) => s.courses.length > 0);
    setActiveSemesterTab(
      (withContent[withContent.length - 1] ?? semList[0])?.semesterKey ?? "",
    );

    setCgpa(record.cgpa ?? 0);
    setTotalCredits(record.gpa_credits);
    // A course sat twice is one course completed, not two.
    setCompletedCourses(
      semList.reduce(
        (n, s) =>
          n + s.courses.filter((c) => !c.attempt || c.attempt.isLatest).length,
        0,
      ),
    );

    // Only finished semesters go on the trend line. A part-published one
    // would draw a dip that is an absence of marks, not a fall in results.
    setGpaChart(
      semList
        .filter((s) => s.sgpa !== null)
        .map((s) => ({
          semester: `Sem ${s.semesterNum}`,
          semesterNum: s.semesterNum,
          gpa: s.sgpa as number,
        })),
    );

    // Grade spread across every graded course. Ordering is applied at render
    // time from the regulation engine's grade scale, not here. A grade a
    // repeat has replaced is left out: it is no longer one of the student's
    // grades, and counting it drew an F the transcript no longer carries.
    const counts = new Map<string, { count: number; gpv: number }>();
    semList.forEach((s) =>
      s.courses.forEach((c) => {
        if (!c.grade) return;
        if (c.attempt && !c.attempt.isLatest) return;
        const existing = counts.get(c.grade);
        counts.set(c.grade, {
          count: (existing?.count ?? 0) + 1,
          gpv: c.gpv ?? existing?.gpv ?? 0,
        });
      }),
    );
    setGradeSpread(
      Array.from(counts.entries()).map(([grade, v]) => ({
        grade,
        count: v.count,
        gpv: v.gpv,
      })),
    );

    setLoading(false);
  };

  /* The last two semesters that actually have a GPA. Every semester of the
     degree is on the page now, so "the last one" would otherwise be an empty
     Semester 8 and the comparison would be against nothing. */
  const graded = semesters.filter((s) => s.sgpa !== null);
  const latest = graded.length > 0 ? graded[graded.length - 1] : null;
  const previous = graded.length > 1 ? graded[graded.length - 2] : null;

  /**
   * Semester-over-semester SGPA movement. Deliberately kept off the CGPA
   * card — this compares two semester GPAs, not the cumulative figure, and
   * labelling it "from last sem" under CGPA was the source of confusion.
   */
  const sgpaDelta =
    latest?.sgpa != null && previous?.sgpa != null
      ? Math.round((latest.sgpa - previous.sgpa) * 100) / 100
      : null;

  const classification = useMemo(() => {
    if (totalCredits === 0) return null;
    return (
      settings.honoursClassifications.find((c) => cgpa >= c.threshold) ?? null
    );
  }, [cgpa, totalCredits, settings.honoursClassifications]);

  /**
   * Grades in academic order — A+, A, A-, B+, B, B-, C+, … — taken from the
   * regulation engine's own grade scale rather than sorted by grade point.
   * Sorting by GPV put A above A+: both are worth 4.00, so the tie fell
   * through to an alphabetical comparison where "A" sorts before "A+".
   * Grades outside the scale (R, L) keep their existing GPV ordering and
   * sit at the end.
   */
  const orderedGradeSpread = useMemo(() => {
    const rank = new Map(
      settings.gradeBoundaries.map((b, index) => [b.grade, index]),
    );
    const unranked = settings.gradeBoundaries.length;
    return [...gradeSpread].sort(
      (a, b) =>
        (rank.get(a.grade) ?? unranked) - (rank.get(b.grade) ?? unranked) ||
        b.gpv - a.gpv ||
        a.grade.localeCompare(b.grade),
    );
  }, [gradeSpread, settings.gradeBoundaries]);

  const activeSemester =
    semesters.find((s) => s.semesterKey === activeSemesterTab) ?? null;

  /* Semesters with at least one result. All eight are on the page, but
     "graded across 8 semesters" counted two with nothing in them. */
  const semestersWithResults = semesters.filter((s) => s.courses.length > 0).length;

  const handleDownloadTranscript = () => {
    setDownloading(true);
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("University of Sri Jayewardenepura", pageWidth / 2, 15, {
        align: "center",
      });
      doc.setFontSize(11);
      doc.text("Faculty of Engineering", pageWidth / 2, 21, {
        align: "center",
      });
      doc.setFontSize(12);
      doc.text("Unofficial Academic Transcript", pageWidth / 2, 29, {
        align: "center",
      });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      let y = 40;
      doc.text(`Name: ${student?.name ?? "-"}`, 14, y);
      doc.text(`Index No: ${student?.index_number ?? "-"}`, 130, y);
      y += 6;
      doc.text(
        `Reg No: ${student?.reg_number ? `EN${student.reg_number}` : "-"}`,
        14,
        y,
      );
      doc.text(`Department: ${student?.department ?? "-"}`, 130, y);
      y += 6;
      doc.text(describeBatch(student?.batch_year), 14, y);
      y += 10;

      // A transcript is a record of what has been awarded, so a semester with
      // nothing published in it does not belong on one.
      semesters
        .filter((sem) => sem.courses.length > 0)
        .forEach((sem) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        const deansListTag =
          sem.sgpa !== null && sem.sgpa >= 3.8 ? "  (Dean's List)" : "";
        const sgpaText =
          sem.sgpa !== null
            ? `SGPA: ${sem.sgpa.toFixed(2)}`
            : "SGPA: pending — not all results published";
        doc.text(
          `Semester ${sem.semesterNum} — ${sem.academicYear}   ${sgpaText}${deansListTag}`,
          14,
          y,
        );
        y += 4;

        autoTable(doc, {
          startY: y,
          head: [["Code", "Course", "Credits", "Grade", "GPV"]],
          body: sem.courses.map((c) => [
            c.code,
            // A transcript keeps every attempt and says which one stands.
            c.attempt && !c.attempt.isLatest
              ? `${c.name} (attempt ${c.attempt.number}, ${c.attempt.academicYear} — replaced)`
              : c.attempt
                ? `${c.name} (repeat, ${c.attempt.academicYear})`
                : c.name,
            String(c.credits),
            c.grade ?? "-",
            c.gpv !== null ? c.gpv.toFixed(1) : "-",
          ]),
          styles: { fontSize: 8, cellPadding: 1.5 },
          headStyles: { fillColor: [196, 30, 58] },
          margin: { left: 14, right: 14 },
        });

        y = (doc as any).lastAutoTable.finalY + 8;
      });

      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(`Cumulative GPA: ${cgpa.toFixed(2)}`, 14, y);
      doc.text(`Total Credits Earned: ${totalCredits}`, 100, y);
      y += 10;

      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(
        "This is a computer-generated summary for personal reference only and is not an official transcript of the University of Sri Jayewardenepura.",
        14,
        y,
        { maxWidth: pageWidth - 28 },
      );

      doc.save(
        `Transcript_${student?.index_number?.replace(/\//g, "-") ?? "student"}.pdf`,
      );
      toast.success("Transcript downloaded", {
        description: "Check your browser's downloads folder.",
      });
    } catch (err) {
      console.error("[Results] transcript generation failed", err);
      toast.error("Could not generate the transcript", {
        description: "Please try again in a moment.",
      });
    } finally {
      setDownloading(false);
    }
  };

  /* ---------------------------------------------------------------- */

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Academic Results"
          description="Your semester-by-semester grades and overall standing."
        />
        <ErrorState message={error} onRetry={fetchResults} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Academic Results"
        description="Your semester-by-semester grades and overall standing."
        actions={
          <div className="flex flex-wrap gap-2">
            {/* The official course sheets are published as documents on the
                notice board, so this page keeps to one thing: this
                student's own record. */}
            <Button variant="outline" asChild>
              <Link to="/app/notices?category=results">
                <Megaphone className="mr-2 h-4 w-4" />
                Published result sheets
              </Link>
            </Button>
          <Button
            onClick={handleDownloadTranscript}
            disabled={loading || downloading || semesters.length === 0}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {downloading ? "Preparing…" : "Download Transcript"}
          </Button>
          </div>
        }
      />

      {/* Summary */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[92px]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            index={0}
            label="Cumulative GPA"
            value={cgpa.toFixed(2)}
            icon={Award}
            tone="brand"
            hint={
              classification
                ? `${classification.label} range`
                : "Awaiting graded credits"
            }
          />
          <StatCard
            index={1}
            label={latest ? `Semester ${latest.semesterNum} GPA` : "Latest SGPA"}
            value={latest?.sgpa != null ? latest.sgpa.toFixed(2) : "—"}
            icon={TrendingUp}
            tone="info"
            trend={
              sgpaDelta !== null && previous
                ? {
                    direction:
                      sgpaDelta > 0 ? "up" : sgpaDelta < 0 ? "down" : "flat",
                    label: `${sgpaDelta > 0 ? "+" : ""}${sgpaDelta.toFixed(2)} vs Semester ${previous.semesterNum}`,
                  }
                : undefined
            }
            hint={previous ? undefined : "No earlier semester to compare"}
          />
          <StatCard
            index={2}
            label="Credits Earned"
            value={totalCredits}
            icon={GraduationCap}
            tone="success"
            hint={`of ${settings.graduationTotalCredits} needed to graduate`}
          />
          <StatCard
            index={3}
            label="Courses Graded"
            value={completedCourses}
            icon={BookOpenCheck}
            tone="neutral"
            hint={`Across ${semestersWithResults} semester${semestersWithResults === 1 ? "" : "s"}`}
          />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GpaTrendChart data={gpaChart} cgpa={cgpa} loading={loading} />

        <ChartContainer
          title="Grade distribution"
          description={`How your ${completedCourses} graded course${completedCourses === 1 ? "" : "s"} break down.`}
          height={250}
          loading={loading}
          hasData={orderedGradeSpread.length > 0}
          emptyTitle="No grades recorded yet"
          summary={`Grade counts: ${orderedGradeSpread
            .map((g) => `${g.grade}: ${g.count}`)
            .join(", ")}.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={orderedGradeSpread}
              layout="vertical"
              margin={{ top: 4, right: 28, left: 4, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                horizontal={false}
              />
              <XAxis
                type="number"
                allowDecimals={false}
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="grade"
                width={40}
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={
                  <ChartTooltip labelFormatter={(l) => `Grade ${l}`} />
                }
              />
              <Bar
                dataKey="count"
                name="Courses"
                radius={[0, 6, 6, 0]}
                animationDuration={chartDuration}
                isAnimationActive={chartDuration > 0}
                shape={(props: any) => {
                  const { x, y, width, height, payload } = props;
                  return (
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      rx={4}
                      fill={TONE_VAR[gradeTone(payload.grade)]}
                    />
                  );
                }}
              >
                <LabelList
                  dataKey="count"
                  position="right"
                  fill="var(--muted-foreground)"
                  fontSize={11}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      {/* Semester detail */}
      {/* The semester tabs sit in the body on their own row, where eight of
          them can scroll on a phone. In the header they sat beside the title
          and, on a narrow screen, on top of it. */}
      <SectionCard title="Semester results" bodyClassName="space-y-4">
        {!loading && semesters.length > 0 && (
          <SegmentedTabs
            aria-label="Select a semester"
            tabs={semesters.map((sem) => ({
              value: sem.semesterKey,
              label: `Sem ${sem.semesterNum}`,
            }))}
            value={activeSemesterTab}
            onChange={setActiveSemesterTab}
            layoutId="results-semester-tab-indicator"
            scrollable
          />
        )}
        {loading ? (
          <SkeletonRows count={5} height="h-12" />
        ) : semesters.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No published results yet"
            description="Results appear here as soon as your department publishes them."
          />
        ) : activeSemester ? (
          <div className="space-y-4">
            {/* Semester summary strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-foreground">
                    {activeSemester.label}
                  </h3>
                  <span className="text-sm text-muted-foreground">
                    {activeSemester.academicYear}
                  </span>
                  {activeSemester.sgpa !== null && activeSemester.sgpa >= 3.8 && (
                    /* An honour, not a warning: brand, not the amber the
                       warning tone would give it. */
                    <StatusBadge tone="brand" icon={Award}>
                      Dean's List
                    </StatusBadge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {activeSemester.courses.length} course
                  {activeSemester.courses.length === 1 ? "" : "s"} ·{" "}
                  {activeSemester.totalCredits} credits counting toward GPA
                </p>
              </div>
              <div className="text-right">
                {/* A semester GPA is only a fact once the semester is. Until
                    then this says what is missing rather than averaging the
                    part that happens to have arrived. */}
                {activeSemester.sgpa !== null ? (
                  <>
                    <div className="text-2xl font-bold text-primary tabular-nums leading-none">
                      {activeSemester.sgpa.toFixed(2)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Semester GPA
                    </p>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-muted-foreground leading-none">
                      GPA pending
                    </div>
                    <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">
                      {activeSemester.published} of {activeSemester.enrolled}{" "}
                      results published. The semester GPA and your CGPA update
                      once the rest are.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* A semester of the degree that has not been marked yet is still
                a semester. It says so rather than being absent from the page. */}
            {activeSemester.courses.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                <p className="text-sm font-medium text-foreground">
                  No results published for {activeSemester.label} yet
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activeSemester.enrolled > 0
                    ? `You are enrolled in ${activeSemester.enrolled} course${activeSemester.enrolled === 1 ? "" : "s"}. Each result appears here as soon as your department publishes it.`
                    : "Results appear here as soon as your department publishes them."}
                </p>
              </div>
            ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              {/* On a phone the code and credits fold under the course name,
                  so the grade and grade point (what the student came for)
                  stay on screen instead of past its right edge. */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden w-[110px] sm:table-cell">Code</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead className="hidden w-[80px] text-center sm:table-cell">
                      Credits
                    </TableHead>
                    <TableHead className="w-[72px] text-center sm:w-[90px]">
                      Grade
                    </TableHead>
                    <TableHead className="w-[56px] text-center sm:w-[70px]">GPV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeSemester.courses.map((course) => {
                    // A course sat twice appears twice — same code, one row
                    // per attempt — so the key has to say which attempt.
                    const superseded =
                      course.attempt !== undefined && !course.attempt.isLatest;
                    const codeClass = cn(
                      "font-semibold tabular-nums whitespace-nowrap",
                      departmentByCourseCode(course.code)?.textClass ?? "text-foreground",
                    );
                    return (
                    <TableRow
                      key={`${course.code}-${course.attempt?.number ?? 1}`}
                      className={superseded ? "opacity-60" : undefined}
                    >
                      <TableCell className={cn("hidden sm:table-cell", codeClass)}>
                        {course.code}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <span className="mb-0.5 flex items-center gap-2 text-xs sm:hidden">
                          <span className={codeClass}>{course.code}</span>
                          <span className="text-muted-foreground">
                            {course.credits} credit{course.credits === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span className="text-foreground">{course.name}</span>
                        {course.attempt && (
                          <StatusBadge
                            tone={superseded ? "neutral" : "info"}
                            className="ml-2"
                          >
                            {superseded
                              ? `Attempt ${course.attempt.number}, ${course.attempt.academicYear} — replaced`
                              : `Repeat, ${course.attempt.academicYear}`}
                          </StatusBadge>
                        )}
                        {!course.contributes_to_gpa && (
                          <StatusBadge tone="neutral" className="ml-2">
                            Not in GPA
                          </StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-center tabular-nums sm:table-cell">
                        {course.credits}
                      </TableCell>
                      <TableCell className="text-center">
                        {course.grade ? (
                          <StatusBadge tone={gradeTone(course.grade)}>
                            {course.grade}
                          </StatusBadge>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            Pending
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">
                        {/* A replaced attempt keeps its grade but carries no
                            grade point, which the badge on its name explains;
                            elsewhere a dash means marks are still awaited. */}
                        {course.gpv !== null ? course.gpv.toFixed(1) : "—"}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            )}
          </div>
        ) : null}
      </SectionCard>

    </div>
  );
}
