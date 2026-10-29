import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { GraduationCap, Calendar, ArrowRight, BookOpen } from "lucide-react";
import { InsightsPanel } from "../components/dashboard/InsightsPanel";
import { LatestNotices } from "../components/dashboard/LatestNotices";
import { Button } from "../components/ui/button";
import {
  AnimatedNumber,
  DepartmentBadge,
  EmptyState,
  GpaTrendChart,
  CourseAttendanceChart,
  HeroCard,
  Reveal,
  SectionCard,
  SkeletonHero,
  SkeletonRows,
  Sparkline,
  StatStrip,
  StatusBadge,
  heroButtonClass,
  heroGhostButtonClass,
  usePageMotion,
  type StatusTone,
} from "../components/common";
import { cn } from "../components/ui/utils";
import { supabase } from "../../lib/supabase";
import { getMyAttendance } from "../../lib/studentAttendance";
import { departmentByCourseCode } from "../../lib/departments";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../../lib/settings";
import { gpaTrendTakeaway } from "../../lib/takeaways";

interface CurrentCourse {
  id: string;
  code: string;
  name: string;
  credits: number;
  /** Null until a lecture of this delivery has been recorded. */
  attendance: number | null;
}

interface SemesterGPA {
  semester: string;
  gpa: number;
}

export default function Dashboard() {
  const { student } = useAuth();
  const navigate = useNavigate();
  const settings = useSettings();
  const pageMotion = usePageMotion();
  const threshold = settings.attendanceThreshold;
  const prewarning = settings.attendancePrewarningThreshold;

  const [cgpa, setCgpa] = useState<number | null>(null);
  const [totalCredits, setTotalCredits] = useState(0);
  /* Null, not zero, until a lecture has actually been recorded. Nought per
     cent is a real and alarming reading; "nothing marked yet" is not, and the
     card was showing the first when it meant the second. */
  const [avgAttendance, setAvgAttendance] = useState<number | null>(null);
  const [courses, setCourses] = useState<CurrentCourse[]>([]);
  const [semesterData, setSemesterData] = useState<SemesterGPA[]>([]);
  const [loading, setLoading] = useState(true);

  /* The surname, which is the last word of the name as the faculty records
     it ("KONARA MUDIYANSELAGE LAHIRU NIRMAL SENADHEERA" → "Senadheera").
     The first word is usually a family or clan name shared by many, so it
     was not the name a student goes by. Names are stored in capitals, so it
     is shown in ordinary case rather than shouted. */
  const surname = (() => {
    const last = student?.name?.trim().split(/\s+/).pop();
    if (!last) return "Student";
    return last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
  })();

  useEffect(() => {
    if (!student?.id) return;
    fetchDashboardData();
  }, [student?.id, threshold]);

  const fetchDashboardData = async () => {
    setLoading(true);
    await Promise.all([fetchGPAData(), fetchCurrentCourses()]);
    setLoading(false);
  };

  const fetchGPAData = async () => {
    // Student-facing reads go through `my_published_results`, which
    // self-scopes to the caller and withholds ese_mark/oa_mark. A superseded
    // attempt carries no grade point, so a course sat twice counts once.
    const { data } = await supabase
      .from("my_published_results")
      .select("gpv, semester, credits, contributes_to_gpa")
      .not("gpv", "is", null);

    if (!data || data.length === 0) return;

    let totalWeighted = 0;
    let credits = 0;
    const semesterMap: Record<number, { weighted: number; credits: number }> = {};

    data.forEach((r: any) => {
      if (!r.contributes_to_gpa) return;
      totalWeighted += r.gpv * r.credits;
      credits += r.credits;
      semesterMap[r.semester] ??= { weighted: 0, credits: 0 };
      semesterMap[r.semester].weighted += r.gpv * r.credits;
      semesterMap[r.semester].credits += r.credits;
    });

    setCgpa(credits > 0 ? Math.round((totalWeighted / credits) * 100) / 100 : null);
    setTotalCredits(credits);
    setSemesterData(
      Object.entries(semesterMap)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([sem, val]) => ({
          semester: `Sem ${sem}`,
          gpa: Math.round((val.weighted / val.credits) * 100) / 100,
        })),
    );
  };

  /* The courses the student is enrolled on now, each with the attendance of
     the delivery being sat. Attendance is counted per delivery: a course
     being repeated has an earlier register too, and this term is the one the
     dashboard reports on. Excused counts in the student's favour, as it does
     everywhere else in the system. */
  const fetchCurrentCourses = async () => {
    const [{ data: enrolled }, attendance] = await Promise.all([
      supabase
        .from("enrollments")
        .select("course_id, courses(course_code, title, credits)")
        .eq("student_id", student!.id)
        .eq("status", "enrolled"),
      getMyAttendance(),
    ]);

    const byCourse: Record<string, { percentage: number; lectures: number }> = {};
    if (attendance.ok) {
      attendance.data.deliveries
        .filter((d) => d.is_latest_attempt)
        .forEach((d) => {
          byCourse[d.course_id] = {
            percentage: Math.round(d.percentage ?? 0),
            lectures: d.lectures,
          };
        });
    }

    const list: CurrentCourse[] = (enrolled ?? [])
      .map((e: any) => {
        const att = byCourse[e.course_id];
        return {
          id: e.course_id,
          code: e.courses?.course_code ?? "",
          name: e.courses?.title ?? "",
          credits: e.courses?.credits ?? 0,
          attendance: att && att.lectures > 0 ? att.percentage : null,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    setCourses(list);

    // Average only over courses that have a lecture recorded: a freshly
    // enrolled course with nothing marked has nothing to average.
    const scored = list.filter((c) => c.attendance !== null);
    setAvgAttendance(
      scored.length > 0
        ? Math.round(scored.reduce((s, c) => s + (c.attendance ?? 0), 0) / scored.length)
        : null,
    );
  };

  const attendanceTone = (pct: number | null): StatusTone =>
    pct === null ? "neutral" : pct < threshold ? "danger" : pct < prewarning ? "warning" : "success";

  const scoredCourses = courses.filter((c) => c.attendance !== null);

  // The class the CGPA puts the student in, from the faculty's thresholds.
  const classLabel =
    cgpa === null
      ? null
      : settings.honoursClassifications.find((c) => cgpa >= c.threshold)?.label ?? "Below Pass";

  /* One sentence under each chart saying what it means. Worked out from the
     same numbers the chart draws, so the two can never disagree. */
  const gpaTakeaway = gpaTrendTakeaway(semesterData);

  const awaiting = courses.length - scoredCourses.length;
  const attendanceTakeaway = (() => {
    if (scoredCourses.length === 0) return undefined;
    const below = scoredCourses.filter((c) => (c.attendance ?? 0) < threshold);
    const more = awaiting > 0 ? ` ${awaiting} more ${awaiting === 1 ? "is" : "are"} waiting for a first lecture.` : "";
    if (below.length > 0) {
      return `${below.length} course${below.length === 1 ? " is" : "s are"} below the ${threshold}% requirement: ${below
        .map((c) => c.code)
        .join(", ")}.${more}`;
    }
    return `${scoredCourses.length === 1 ? "Your one course" : `All ${scoredCourses.length} courses`} with lectures recorded ${
      scoredCourses.length === 1 ? "is" : "are"
    } at or above ${threshold}%.${more}`;
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div {...pageMotion}>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Welcome back, {surname}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {student?.department && <DepartmentBadge department={student.department} />}
          <p className="text-sm text-muted-foreground">
            Your academic progress at a glance.
          </p>
        </div>
      </motion.div>

      {/* The number a student comes for, and what needs them now, side by
          side. The other headline numbers ride along the hero's foot, each
          still opening the page that explains it. */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {loading ? (
          <SkeletonHero className="lg:col-span-2" />
        ) : (
          <HeroCard
            className="lg:col-span-2"
            eyebrow="Current CGPA"
            value={cgpa === null ? "—" : <AnimatedNumber value={cgpa} decimals={2} />}
            label={classLabel}
            meta={
              cgpa === null
                ? "Your CGPA appears once your first results are published."
                : "Cumulative GPA over every published result."
            }
            progress={{
              value: totalCredits,
              max: settings.graduationTotalCredits,
              label: "Credits completed towards graduation",
              caption: `${totalCredits} of ${settings.graduationTotalCredits} credits completed`,
            }}
            actions={
              <>
                <Button size="sm" className={heroButtonClass} onClick={() => navigate("/app/results")}>
                  View results
                </Button>
                <Button size="sm" variant="ghost" className={heroGhostButtonClass} onClick={() => navigate("/app/planner")}>
                  Graduation Planner
                </Button>
              </>
            }
            aside={
              semesterData.length > 1 ? (
                <div className="hidden flex-col items-start gap-1 sm:flex lg:items-end">
                  <Sparkline
                    onHero
                    data={semesterData.map((p) => ({ label: p.semester, value: p.gpa }))}
                  />
                  <p className="text-[11px] text-[var(--hero-muted)]">SGPA by semester</p>
                </div>
              ) : undefined
            }
            footer={
              <StatStrip
                onHero
                items={[
                  {
                    label: courses.length === 1 ? "course this semester" : "courses this semester",
                    value: courses.length,
                    icon: GraduationCap,
                    onClick: () => navigate("/app/enrollment"),
                  },
                  {
                    /* Saying "below the required 80%" to a student whose lectures
                       have simply not been marked yet is a warning about nothing. */
                    label:
                      avgAttendance === null
                        ? "attendance: no lectures recorded yet"
                        : avgAttendance >= threshold
                          ? `average attendance · ${threshold}% required`
                          : `average attendance · below the required ${threshold}%`,
                    value: avgAttendance === null ? "—" : `${avgAttendance}%`,
                    icon: Calendar,
                    onClick: () => navigate("/app/attendance"),
                  },
                ]}
              />
            }
          />
        )}

        {/* What the system noticed without being asked. */}
        <InsightsPanel />
      </div>

      {/* The two charts side by side near the top, as the dashboard had them
          before: the GPA by semester, and this semester's attendance by
          course. Each says in a line what it means. */}
      <Reveal index={1} className="grid items-start gap-4 lg:grid-cols-2">
        <GpaTrendChart
          data={semesterData}
          cgpa={cgpa ?? 0}
          loading={loading}
          height={260}
          takeaway={gpaTakeaway}
        />
        <CourseAttendanceChart
          title="Attendance by course"
          data={scoredCourses.map((c) => ({ code: c.code, percentage: c.attendance ?? 0 }))}
          threshold={threshold}
          prewarning={prewarning}
          awaitingCount={awaiting}
          loading={loading}
          takeaway={attendanceTakeaway}
        />
      </Reveal>

      {/* This semester, with the notice board beside it. The notices column
          hides itself when there are none, and the courses take the width. */}
      <Reveal index={2} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <SectionCard
          title="This semester"
          description="The courses you are enrolled on, with attendance for this sitting."
          actions={
            <Button
              variant="ghost"
              size="sm"
              className="text-primary hover:text-primary/80"
              onClick={() => navigate("/app/attendance")}
            >
              Attendance
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          }
          className="min-w-0 flex-1"
          flush
        >
          {loading ? (
            <div className="p-4">
              <SkeletonRows count={4} />
            </div>
          ) : courses.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="You are not enrolled on any course right now"
              description="When an enrolment window opens for your batch, the courses you choose will appear here."
              action={
                <Button size="sm" variant="outline" onClick={() => navigate("/app/enrollment")}>
                  Go to Enrollment
                </Button>
              }
              size="inline"
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {courses.map((c) => {
                const dept = departmentByCourseCode(c.code);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => navigate("/app/attendance")}
                      className={cn(
                        "flex w-full items-center gap-3 border-l-4 px-4 py-2.5 text-left transition-colors",
                        dept?.stripeClass ?? "border-l-transparent",
                        dept?.hoverClass ?? "hover:bg-muted/50",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("text-sm font-semibold tabular-nums", dept?.textClass ?? "text-foreground")}>
                            {c.code}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {c.credits} credit{c.credits === 1 ? "" : "s"}
                          </span>
                          {dept && (
                            <span className="hidden text-xs text-muted-foreground sm:inline">
                              · {dept.name}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-sm text-foreground">{c.name}</span>
                      </span>
                      <StatusBadge tone={attendanceTone(c.attendance)} dot>
                        {c.attendance === null ? "No lectures yet" : `${c.attendance}%`}
                      </StatusBadge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <div className="w-full empty:hidden lg:w-[380px] lg:flex-shrink-0">
          <LatestNotices />
        </div>
      </Reveal>

    </div>
  );
}
