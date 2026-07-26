import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BookOpenCheck,
  Download,
  GraduationCap,
  Loader2,
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
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { describeBatch } from "../../lib/batch";
import { useSettings } from "../../lib/settings";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface CourseResult {
  code: string;
  name: string;
  credits: number;
  mid_sem: number | null;
  ca: number | null;
  ese: number | null;
  oa: number | null;
  grade: string | null;
  gpv: number | null;
  contributes_to_gpa: boolean;
}

interface SemesterData {
  semesterKey: string;
  label: string;
  academicYear: string;
  semesterNum: number;
  courses: CourseResult[];
  sgpa: number;
  totalCredits: number;
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

  const fetchResults = async () => {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from("results")
      .select(
        `
        course_id,
        academic_year,
        mid_sem_mark,
        ca_mark,
        ese_mark,
        oa_mark,
        grade,
        gpv,
        is_published,
        courses (
          course_code,
          title,
          credits,
          semester,
          contributes_to_gpa
        )
      `,
      )
      .eq("student_id", student!.id)
      .eq("is_published", true)
      .order("academic_year", { ascending: true });

    if (queryError) {
      console.error("[Results] failed to load results", queryError);
      setError("We could not load your results. Please try again.");
      setLoading(false);
      return;
    }

    if (!data || data.length === 0) {
      setSemesters([]);
      setGpaChart([]);
      setGradeSpread([]);
      setLoading(false);
      return;
    }

    // Group by semester number
    const semesterMap: Record<
      string,
      {
        academicYear: string;
        semNum: number;
        courses: CourseResult[];
      }
    > = {};

    data.forEach((r: any) => {
      const course = r.courses;
      const semNum = course.semester;
      const key = `sem_${semNum}`;

      if (!semesterMap[key]) {
        semesterMap[key] = {
          academicYear: r.academic_year,
          semNum,
          courses: [],
        };
      }

      semesterMap[key].courses.push({
        code: course.course_code,
        name: course.title,
        credits: course.credits,
        mid_sem: r.mid_sem_mark,
        ca: r.ca_mark,
        ese: r.ese_mark,
        oa: r.oa_mark,
        grade: r.grade,
        gpv: r.gpv,
        contributes_to_gpa: course.contributes_to_gpa,
      });
    });

    // Build semester summaries
    const semList: SemesterData[] = Object.entries(semesterMap)
      .sort((a, b) => a[1].semNum - b[1].semNum)
      .map(([key, val]) => {
        const gpaCourses = val.courses.filter(
          (c) => c.contributes_to_gpa && c.gpv !== null,
        );
        const weightedSum = gpaCourses.reduce(
          (sum, c) => sum + (c.gpv ?? 0) * c.credits,
          0,
        );
        const creditSum = gpaCourses.reduce((sum, c) => sum + c.credits, 0);
        const sgpa =
          creditSum > 0 ? Math.round((weightedSum / creditSum) * 100) / 100 : 0;

        return {
          semesterKey: key,
          label: `Semester ${val.semNum}`,
          academicYear: val.academicYear,
          semesterNum: val.semNum,
          courses: val.courses,
          sgpa,
          totalCredits: creditSum,
        };
      });

    setSemesters(semList);
    if (semList.length > 0) {
      // Open on the most recent semester — the one a student actually
      // came to look at. The old default was Semester 1.
      setActiveSemesterTab(semList[semList.length - 1].semesterKey);
    }

    // CGPA
    const allGpaCourses = semList.flatMap((s) =>
      s.courses.filter((c) => c.contributes_to_gpa && c.gpv !== null),
    );
    const totalWeighted = allGpaCourses.reduce(
      (sum, c) => sum + (c.gpv ?? 0) * c.credits,
      0,
    );
    const totalCr = allGpaCourses.reduce((sum, c) => sum + c.credits, 0);
    const cgpaVal =
      totalCr > 0 ? Math.round((totalWeighted / totalCr) * 100) / 100 : 0;

    setCgpa(cgpaVal);
    setTotalCredits(totalCr);
    setCompletedCourses(data.length);

    // GPA chart
    setGpaChart(
      semList.map((s) => ({
        semester: `Sem ${s.semesterNum}`,
        semesterNum: s.semesterNum,
        gpa: s.sgpa,
      })),
    );

    // Grade spread across every graded course, ordered best grade first.
    const counts = new Map<string, { count: number; gpv: number }>();
    semList.forEach((s) =>
      s.courses.forEach((c) => {
        if (!c.grade) return;
        const existing = counts.get(c.grade);
        counts.set(c.grade, {
          count: (existing?.count ?? 0) + 1,
          gpv: c.gpv ?? existing?.gpv ?? 0,
        });
      }),
    );
    setGradeSpread(
      Array.from(counts.entries())
        .map(([grade, v]) => ({ grade, count: v.count, gpv: v.gpv }))
        .sort((a, b) => b.gpv - a.gpv || a.grade.localeCompare(b.grade)),
    );

    setLoading(false);
  };

  const latest = semesters.length > 0 ? semesters[semesters.length - 1] : null;
  const previous = semesters.length > 1 ? semesters[semesters.length - 2] : null;

  /**
   * Semester-over-semester SGPA movement. Deliberately kept off the CGPA
   * card — this compares two semester GPAs, not the cumulative figure, and
   * labelling it "from last sem" under CGPA was the source of confusion.
   */
  const sgpaDelta =
    latest && previous
      ? Math.round((latest.sgpa - previous.sgpa) * 100) / 100
      : null;

  const classification = useMemo(() => {
    if (totalCredits === 0) return null;
    return (
      settings.honoursClassifications.find((c) => cgpa >= c.threshold) ?? null
    );
  }, [cgpa, totalCredits, settings.honoursClassifications]);

  const activeSemester =
    semesters.find((s) => s.semesterKey === activeSemesterTab) ?? null;

  /**
   * Component marks (Mid Sem / CA / ESE) are optional in this dataset — the
   * historical import carries grades and grade points only. Showing four
   * permanently empty columns made the table look broken, so they appear
   * only for semesters that actually have component data.
   */
  const showComponentMarks = activeSemester
    ? activeSemester.courses.some(
        (c) => c.mid_sem !== null || c.ca !== null || c.ese !== null,
      )
    : false;

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

      semesters.forEach((sem) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        const deansListTag = sem.sgpa >= 3.8 ? "  (Dean's List)" : "";
        doc.text(
          `Semester ${sem.semesterNum} — ${sem.academicYear}   SGPA: ${sem.sgpa.toFixed(2)}${deansListTag}`,
          14,
          y,
        );
        y += 4;

        autoTable(doc, {
          startY: y,
          head: [["Code", "Course", "Credits", "Grade", "GPV"]],
          body: sem.courses.map((c) => [
            c.code,
            c.name,
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
            value={latest ? latest.sgpa.toFixed(2) : "—"}
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
            hint={`Across ${semesters.length} semester${semesters.length === 1 ? "" : "s"}`}
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
          hasData={gradeSpread.length > 0}
          emptyTitle="No grades recorded yet"
          summary={`Grade counts: ${gradeSpread
            .map((g) => `${g.grade}: ${g.count}`)
            .join(", ")}.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={gradeSpread}
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
      <SectionCard
        title="Semester results"
        description={
          activeSemester
            ? `${activeSemester.label} — ${activeSemester.academicYear}`
            : undefined
        }
        actions={
          semesters.length > 0 ? (
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
          ) : undefined
        }
      >
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
                  {activeSemester.sgpa >= 3.8 && (
                    <StatusBadge tone="warning" icon={Award}>
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
                <div className="text-2xl font-bold text-primary tabular-nums leading-none">
                  {activeSemester.sgpa.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Semester GPA
                </p>
              </div>
            </div>

            {/* Course table */}
            <div className="rounded-xl border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">Code</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead className="text-center w-[80px]">
                      Credits
                    </TableHead>
                    {showComponentMarks && (
                      <>
                        <TableHead className="text-center w-[90px]">
                          Mid Sem
                        </TableHead>
                        <TableHead className="text-center w-[70px]">
                          CA
                        </TableHead>
                        <TableHead className="text-center w-[70px]">
                          ESE
                        </TableHead>
                      </>
                    )}
                    <TableHead className="text-center w-[90px]">
                      Grade
                    </TableHead>
                    <TableHead className="text-center w-[70px]">GPV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeSemester.courses.map((course) => (
                    <TableRow key={course.code}>
                      <TableCell className="font-medium text-primary whitespace-nowrap">
                        {course.code}
                      </TableCell>
                      <TableCell>
                        <span className="text-foreground">{course.name}</span>
                        {!course.contributes_to_gpa && (
                          <StatusBadge tone="neutral" className="ml-2">
                            Not in GPA
                          </StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {course.credits}
                      </TableCell>
                      {showComponentMarks && (
                        <>
                          <TableCell className="text-center tabular-nums text-muted-foreground">
                            {course.mid_sem ?? "—"}
                          </TableCell>
                          <TableCell className="text-center tabular-nums text-muted-foreground">
                            {course.ca ?? "—"}
                          </TableCell>
                          <TableCell className="text-center tabular-nums text-muted-foreground">
                            {course.ese ?? "—"}
                          </TableCell>
                        </>
                      )}
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
                        {course.gpv !== null ? course.gpv.toFixed(1) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
