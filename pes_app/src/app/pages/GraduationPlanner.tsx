import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Award,
  CheckCircle2,
  ClipboardPen,
  FlaskConical,
  GraduationCap,
  Hourglass,
  RotateCcw,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Tabs, TabsContent } from "../components/ui/tabs";
import {
  EmptyState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  SkeletonStatGrid,
  StatCard,
  StatusBadge,
} from "../components/common";
import { cn } from "../components/ui/utils";
import { departmentByCourseCode } from "../../lib/departments";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useSettings, getSettings } from "../../lib/settings";


// Elective credit totals per department+semester, taken directly from the
// handbook's "Elective (N)" labels — e.g. CO Sem7 has "Elective (2)" +
// "Elective (3)" groups = 5 elective credits required, on top of compulsory.
const EXPECTED_ELECTIVE_CREDITS: Record<string, Record<number, number>> = {
  "Computer Engineering": { 7: 5, 8: 5 },
  "Civil Engineering": { 7: 6, 8: 10 },
  "Electrical and Electronic Engineering": { 7: 5, 8: 9 },
  "Mechanical Engineering": { 7: 5, 8: 5 },
};



/** The "—" choice: no guess, so the course is not counted. */
const NO_GUESS = "__none__";

const classificationForGpa = (gpa: number): string => {
  const match = getSettings().honoursClassifications.find(
    (c) => gpa >= c.threshold,
  );
  return match?.label ?? "Below Pass";
};

interface CourseResult {
  resultRowId: string;
  courseId: string;
  code: string;
  title: string;
  semester: number;
  credits: number;
  contributesToGpa: boolean;
  actualGrade: string | null;
  /** The grade point the department recorded with the grade. Used as it
   *  stands, so this page's CGPA is the same number the rest of the system
   *  shows; the scale below is only for grades a student is trying out. */
  actualGpv: number | null;
}

/** A course the student is sitting now, with no result yet. */
interface InProgressCourse {
  courseId: string;
  code: string;
  title: string;
  semester: number;
  credits: number;
}

/* Guessed grades stay in this browser. They are the student's own
   what-ifs, never sent anywhere, and kept only so they survive a reload. */
const guessKey = (studentId: string) => `pes.planner.guesses.${studentId}`;
function loadGuesses(studentId: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(guessKey(studentId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveGuesses(studentId: string, guesses: Record<string, string>) {
  try {
    if (Object.keys(guesses).length === 0) window.localStorage.removeItem(guessKey(studentId));
    else window.localStorage.setItem(guessKey(studentId), JSON.stringify(guesses));
  } catch {
    /* Private window or blocked storage: the guesses just don't persist. */
  }
}

interface SemesterCredit {
  semester: number;
  compulsoryCredits: number;
}

export default function GraduationPlanner() {
  const { student } = useAuth();
  const settings = useSettings();
  const TOTAL_CREDITS_REQUIRED = settings.graduationTotalCredits;
  const TOTAL_SEMESTERS = settings.totalSemesters;
  const GPV = settings.gpvScale;
  const GRADE_OPTIONS = Object.keys(GPV);
  const CLASSIFICATIONS = settings.honoursClassifications;
  const [loading, setLoading] = useState(true);
  const [allCourses, setAllCourses] = useState<CourseResult[]>([]);
  const [simulatedGrades, setSimulatedGrades] = useState<
    Record<string, string>
  >({});
  const [inProgress, setInProgress] = useState<InProgressCourse[]>([]);
  // Keyed by course id: the grade the student expects in a course they are
  // sitting now. A course left without one is not counted.
  const [guessedGrades, setGuessedGrades] = useState<Record<string, string>>({});
  const [remainingSemesterCredits, setRemainingSemesterCredits] = useState<
    SemesterCredit[]
  >([]);
  const [activeTab, setActiveTab] = useState("standing");

  useEffect(() => {
    if (!student?.id) return;
    fetchData();
  }, [student?.id]);

  const fetchData = async () => {
    setLoading(true);

    const { data: results } = await supabase
      .from("my_published_results")
      .select(
        "id, grade, gpv, course_id, course_code, course_title, semester, credits, contributes_to_gpa, academic_year",
      )
      .not("gpv", "is", null);

    /* The courses the student is sitting this semester. One already graded
       for this academic year is in the results above; the rest are what the
       student can put a guess against. A course with no GPA weight cannot
       move the GPA, so it is left out. */
    const { data: enrolled } = await supabase
      .from("enrollments")
      .select(
        "course_id, academic_year, courses(course_code, title, semester, credits, contributes_to_gpa)",
      )
      .eq("student_id", student!.id)
      .eq("status", "enrolled");
    const graded = new Set(
      (results ?? []).map((r: any) => `${r.course_id}|${r.academic_year}`),
    );
    const current: InProgressCourse[] = (enrolled ?? [])
      .filter(
        (e: any) =>
          e.courses?.contributes_to_gpa &&
          !graded.has(`${e.course_id}|${e.academic_year}`),
      )
      .map((e: any) => ({
        courseId: e.course_id,
        code: e.courses.course_code,
        title: e.courses.title,
        semester: e.courses.semester,
        credits: e.courses.credits,
      }))
      .sort((a, b) => a.semester - b.semester || a.code.localeCompare(b.code));
    setInProgress(current);
    const saved = loadGuesses(student!.id);
    setGuessedGrades(
      Object.fromEntries(
        Object.entries(saved).filter(
          ([id, g]) => current.some((c) => c.courseId === id) && g in GPV,
        ),
      ),
    );

    const courseRows: CourseResult[] = (results ?? []).map((r: any) => ({
      resultRowId: r.id,
      courseId: r.course_id,
      code: r.course_code,
      title: r.course_title,
      semester: r.semester,
      credits: r.credits,
      contributesToGpa: r.contributes_to_gpa,
      actualGrade: r.grade,
      actualGpv: r.gpv,
    }));

    setAllCourses(courseRows);

    // Highest semester already graded — everything above it is still ahead.
    const maxSem = Math.max(
      0,
      ...courseRows.filter((c) => c.contributesToGpa).map((c) => c.semester),
    );

    if (student?.department) {
      const { data: futureCourses } = await supabase
        .from("courses")
        .select("semester, credits, category, contributes_to_gpa")
        .in("department", [student.department, "Interdisciplinary Studies"])
        .gt("semester", maxSem)
        .eq("category", "Compulsory")
        .eq("contributes_to_gpa", true);

      const bySem: Record<number, number> = {};
      (futureCourses ?? []).forEach((c: any) => {
        bySem[c.semester] = (bySem[c.semester] ?? 0) + c.credits;
      });

      const list: SemesterCredit[] = [];
      for (let s = maxSem + 1; s <= TOTAL_SEMESTERS; s++) {
        list.push({ semester: s, compulsoryCredits: bySem[s] ?? 0 });
      }
      setRemainingSemesterCredits(list);
    }

    setLoading(false);
  };

  const computeStanding = (
    gradeOverrides: Record<string, string>,
    guesses: Record<string, string> = {},
  ) => {
    const gpaCourses = allCourses.filter((c) => c.contributesToGpa);
    let totalWeighted = 0;
    let totalCredits = 0;
    const bySemester: Record<number, { weighted: number; credits: number }> =
      {};

    gpaCourses.forEach((c) => {
      /* A grade the student is trying out is worth whatever the faculty's
         scale says; one already awarded is worth what was recorded with it.
         Reading the scale for both meant a grade the scale does not list
         counted as zero here and as its real value everywhere else. */
      const override = gradeOverrides[c.resultRowId];
      const gpv = override
        ? (GPV[override] ?? 0)
        : (c.actualGpv ?? (c.actualGrade ? (GPV[c.actualGrade] ?? 0) : 0));
      totalWeighted += gpv * c.credits;
      totalCredits += c.credits;
      if (!bySemester[c.semester])
        bySemester[c.semester] = { weighted: 0, credits: 0 };
      bySemester[c.semester].weighted += gpv * c.credits;
      bySemester[c.semester].credits += c.credits;
    });

    /* A guess counts as one more result, the way the official CGPA will
       count it once the real grade is published: credits from the course
       catalogue, worth what the scale says. A course being repeated keeps
       its earlier attempt, as the official record does. */
    inProgress.forEach((c) => {
      const guess = guesses[c.courseId];
      if (!guess) return;
      const gpv = GPV[guess] ?? 0;
      totalWeighted += gpv * c.credits;
      totalCredits += c.credits;
      if (!bySemester[c.semester])
        bySemester[c.semester] = { weighted: 0, credits: 0 };
      bySemester[c.semester].weighted += gpv * c.credits;
      bySemester[c.semester].credits += c.credits;
    });

    const cgpa =
      totalCredits > 0
        ? Math.round((totalWeighted / totalCredits) * 100) / 100
        : 0;

    const semesterGpas = Object.entries(bySemester)
      .map(([sem, v]) => ({
        semester: Number(sem),
        sgpa:
          v.credits > 0 ? Math.round((v.weighted / v.credits) * 100) / 100 : 0,
        credits: v.credits,
      }))
      .sort((a, b) => a.semester - b.semester);

    return { cgpa, totalCredits, semesterGpas };
  };

  const actualStanding = useMemo(() => computeStanding({}), [allCourses]);
  const simulatedStanding = useMemo(
    () => computeStanding(simulatedGrades, guessedGrades),
    [allCourses, simulatedGrades, inProgress, guessedGrades],
  );

  const guessCount = Object.keys(guessedGrades).length;
  const guessedCredits = inProgress
    .filter((c) => guessedGrades[c.courseId])
    .reduce((n, c) => n + c.credits, 0);
  const hasSimulation = Object.keys(simulatedGrades).length > 0 || guessCount > 0;

  const setGuess = (courseId: string, grade: string | null) => {
    setGuessedGrades((prev) => {
      const next = { ...prev };
      if (grade) next[courseId] = grade;
      else delete next[courseId];
      if (student?.id) saveGuesses(student.id, next);
      return next;
    });
  };

  const resetSimulation = () => {
    setSimulatedGrades({});
    setGuessedGrades({});
    if (student?.id) saveGuesses(student.id, {});
  };

  const inProgressBySemester = useMemo(() => {
    const groups: Record<number, InProgressCourse[]> = {};
    inProgress.forEach((c) => {
      (groups[c.semester] ??= []).push(c);
    });
    return Object.entries(groups)
      .map(([sem, courses]) => ({ semester: Number(sem), courses }))
      .sort((a, b) => a.semester - b.semester);
  }, [inProgress]);
  const inProgressSemesters = inProgressBySemester.map((g) => g.semester);

  const buildProjections = (cgpa: number, credits: number) => {
    const remaining = Math.max(0, TOTAL_CREDITS_REQUIRED - credits);
    const currentQualityPoints = cgpa * credits;

    return CLASSIFICATIONS.map((c) => {
      const requiredQualityPoints = c.threshold * TOTAL_CREDITS_REQUIRED;
      const requiredAvg =
        remaining > 0
          ? (requiredQualityPoints - currentQualityPoints) / remaining
          : 0;
      return {
        ...c,
        requiredAvg: Math.max(0, Math.min(4.0, requiredAvg)),
        alreadySecured: requiredAvg <= 0,
        feasible: requiredAvg <= 4.0,
        remainingCredits: remaining,
      };
    });
  };

  const activeCgpa =
    activeTab === "simulator" ? simulatedStanding.cgpa : actualStanding.cgpa;
  const activeCredits =
    activeTab === "simulator"
      ? simulatedStanding.totalCredits
      : actualStanding.totalCredits;
  const remainingCredits = Math.max(0, TOTAL_CREDITS_REQUIRED - activeCredits);
  const projections = useMemo(
    () => buildProjections(activeCgpa, activeCredits),
    [activeCgpa, activeCredits],
  );

  const bestPossibleCgpa =
    remainingCredits > 0
      ? Math.round(
          ((activeCgpa * activeCredits + remainingCredits * 4.0) /
            TOTAL_CREDITS_REQUIRED) *
            100,
        ) / 100
      : activeCgpa;

  // Accurate per-semester total credits: confirmed compulsory (from DB) +
  // expected elective credits (from the handbook's Elective(N) labels)
  const fullyGuessed = (semester: number) =>
    activeTab === "simulator" &&
    inProgress.some((c) => c.semester === semester) &&
    inProgress
      .filter((c) => c.semester === semester)
      .every((c) => guessedGrades[c.courseId]);
  const semesterTotals = remainingSemesterCredits
    .filter((sem) => !fullyGuessed(sem.semester))
    .map((sem) => {
    const expectedElective =
      EXPECTED_ELECTIVE_CREDITS[student?.department ?? ""]?.[sem.semester] ??
      null;
    const total =
      expectedElective !== null
        ? sem.compulsoryCredits + expectedElective
        : null;
    return { ...sem, expectedElective, total };
  });

  const coursesBySemester = useMemo(() => {
    const gpaCourses = allCourses.filter((c) => c.contributesToGpa);
    const groups: Record<number, CourseResult[]> = {};
    gpaCourses.forEach((c) => {
      if (!groups[c.semester]) groups[c.semester] = [];
      groups[c.semester].push(c);
    });
    return Object.entries(groups)
      .map(([sem, courses]) => ({ semester: Number(sem), courses }))
      .sort((a, b) => a.semester - b.semester);
  }, [allCourses]);

  const renderStandingCards = (cgpa: number, credits: number) => {
    const simulated = activeTab === "simulator";
    const projected = simulated && hasSimulation;
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          index={0}
          label={projected ? "Projected CGPA" : "Current CGPA"}
          value={cgpa.toFixed(2)}
          icon={Award}
          tone="brand"
          hint={
            projected
              ? `${classificationForGpa(cgpa)} · now ${actualStanding.cgpa.toFixed(2)}`
              : classificationForGpa(cgpa)
          }
        />
        <StatCard
          index={1}
          label={projected && guessedCredits > 0 ? "Credits counted" : "Credits completed"}
          value={credits}
          icon={GraduationCap}
          tone="neutral"
          hint={
            projected && guessedCredits > 0
              ? `including ${guessedCredits} you are sitting now`
              : `of ${TOTAL_CREDITS_REQUIRED} counted toward the GPA`
          }
        />
        <StatCard
          index={2}
          label="Credits remaining"
          value={Math.max(0, TOTAL_CREDITS_REQUIRED - credits)}
          icon={Hourglass}
          tone="info"
          hint={
            semesterTotals.length > 0
              ? `Semester ${semesterTotals.map((s) => s.semester).join(" and ")}`
              : undefined
          }
        />
        <StatCard
          index={3}
          label="Best possible CGPA"
          value={bestPossibleCgpa.toFixed(2)}
          icon={TrendingUp}
          tone="success"
          hint="With an A+ in every remaining course"
        />
      </div>
    );
  };

  /* Which semesters are left and roughly what they carry, e.g.
     "Semester 7 (17 credits) and Semester 8 (17 credits)". */
  const remainingSemestersText = semesterTotals
    .map((s) =>
      s.total !== null
        ? `Semester ${s.semester} (${s.total} credits)`
        : `Semester ${s.semester}`,
    )
    .join(" and ");

  /* One card, where there used to be two saying the same thing. A second
     "Semester-by-Semester Targets" card repeated each average below as the
     SGPA to hold in every remaining semester (it is the same number, since
     the CGPA is a credit-weighted average) and then spent a paragraph
     explaining why. That is now one line in this card's description. */
  const renderProjectionsCard = () => (
    <SectionCard
      title="What you need for each class"
      description={
        remainingSemestersText
          ? `The average GPA your remaining credits must reach. Hold that SGPA in each of ${remainingSemestersText} and you reach the class.`
          : "The average GPA your remaining credits must reach."
      }
      bodyClassName="space-y-2.5"
    >
      {projections.map((p) => (
        <div
          key={p.key}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border p-3"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-foreground">{p.label}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                CGPA ≥ {p.threshold.toFixed(2)}
              </span>
            </div>
            {p.alreadySecured ? (
              <p className="mt-1 flex items-center gap-1 text-sm text-success-fg">
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                Already secured: even a 0.00 average in your remaining{" "}
                {p.remainingCredits} credits keeps you above this.
              </p>
            ) : !p.feasible ? (
              <p className="mt-1 flex items-center gap-1 text-sm text-danger-fg">
                <XCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                No longer reachable: it would need more than a 4.00 average.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Average{" "}
                <strong className="text-lg font-bold text-foreground tabular-nums">
                  {p.requiredAvg.toFixed(2)}
                </strong>{" "}
                across your remaining {p.remainingCredits} credits
              </p>
            )}
          </div>
          {p.alreadySecured ? (
            <StatusBadge tone="success" dot>Secured</StatusBadge>
          ) : !p.feasible ? (
            <StatusBadge tone="danger" dot>Not achievable</StatusBadge>
          ) : p.requiredAvg >= 3.8 ? (
            <StatusBadge tone="warning" dot>Challenging</StatusBadge>
          ) : (
            <StatusBadge tone="info" dot>On track</StatusBadge>
          )}
        </div>
      ))}
      {activeTab === "standing" &&
        (inProgress.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              Semester {inProgressSemesters.join(" and ")} is in progress. Put
              in the grades you expect and see your CGPA with them.
            </p>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("simulator")}>
              <ClipboardPen className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Guess this semester's grades
            </Button>
          </div>
        ) : (
          <p className="pt-1 text-xs text-muted-foreground">
            Want to plan one semester harder than another, or see what a
            different grade would have done? Try the What-If Simulator.
          </p>
        ))}
    </SectionCard>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Graduation Planner"
        description="See what GPA you need in your remaining semesters, or try different grades to see what they would change."
      />

      {loading ? (
        <div className="space-y-4">
          <SkeletonStatGrid count={4} />
          <SkeletonRows count={4} height="h-16" />
        </div>
      ) : remainingCredits === 0 && activeTab === "standing" ? (
        <SectionCard>
          <EmptyState
            icon={CheckCircle2}
            title={`You have completed the required ${TOTAL_CREDITS_REQUIRED} credits`}
            description={`Your final class follows from your CGPA of ${actualStanding.cgpa.toFixed(2)}: ${classificationForGpa(actualStanding.cgpa)}.`}
            size="inline"
          />
        </SectionCard>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <SegmentedTabs
            tabs={[
              { value: "standing", label: "Current Standing" },
              { value: "simulator", label: "What-If Simulator" },
            ]}
            value={activeTab}
            onChange={setActiveTab}
            layoutId="planner-tab-indicator"
            aria-label="Planner view"
            className="self-start"
          />

          <TabsContent value="standing" className="mt-5 space-y-5">
            {renderStandingCards(
              actualStanding.cgpa,
              actualStanding.totalCredits,
            )}
            {renderProjectionsCard()}

          </TabsContent>

          <TabsContent value="simulator" className="mt-5 space-y-5">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-start justify-between gap-3 flex-wrap"
            >
              <div className="flex gap-2.5">
                <FlaskConical className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">
                  {inProgress.length > 0
                    ? "Put in the grades you expect this semester, or change a past grade, to see your SGPA, CGPA and what you'd need going forward."
                    : "Change any past module's grade below to see how it would have affected your SGPA, CGPA, and what you'd need going forward."}{" "}
                  These are projections only —{" "}
                  <strong>
                    nothing here changes your real academic record.
                  </strong>
                </p>
              </div>
              {hasSimulation && (
                <Button variant="outline" size="sm" onClick={resetSimulation}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reset to actual results
                </Button>
              )}
            </motion.div>

            {renderStandingCards(
              simulatedStanding.cgpa,
              simulatedStanding.totalCredits,
            )}

            {inProgressBySemester.length > 0 && (
              <SectionCard
                title="This semester's courses"
                description="No results yet. Pick the grade you expect in each; a course left at “—” is not counted. Your guesses stay on this device."
                bodyClassName="space-y-4"
              >
                {inProgressBySemester.map((group) => {
                  const guessed = group.courses.filter((c) => guessedGrades[c.courseId]);
                  const sem = simulatedStanding.semesterGpas.find(
                    (s) => s.semester === group.semester,
                  );
                  return (
                    <div key={group.semester}>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-foreground">
                          Semester {group.semester} — in progress
                        </h4>
                        <StatusBadge tone={guessed.length > 0 ? "brand" : "neutral"}>
                          {guessed.length > 0 && sem
                            ? `Projected SGPA: ${sem.sgpa.toFixed(2)}`
                            : "Pick grades to see your SGPA"}
                        </StatusBadge>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {guessed.length} of {group.courses.length} courses
                        </span>
                      </div>
                      <div className="space-y-2">
                        {group.courses.map((c) => {
                          const guess = guessedGrades[c.courseId];
                          const dept = departmentByCourseCode(c.code);
                          return (
                            <div
                              key={c.courseId}
                              className={cn(
                                "flex items-center justify-between gap-3 rounded-lg border-l-4 p-2.5 transition-colors",
                                dept?.stripeClass ?? "border-l-transparent",
                                guess
                                  ? "bg-primary/5 ring-1 ring-inset ring-primary/20"
                                  : cn("bg-muted/30", dept?.hoverClass),
                              )}
                            >
                              <div className="flex min-w-0 flex-col gap-x-2 sm:flex-row sm:items-center">
                                <span className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "text-xs font-semibold tabular-nums flex-shrink-0",
                                      dept?.textClass ?? "text-foreground",
                                    )}
                                  >
                                    {c.code}
                                  </span>
                                  <span className="text-xs text-muted-foreground sm:hidden">
                                    {c.credits} credit{c.credits === 1 ? "" : "s"}
                                  </span>
                                </span>
                                <span className="text-sm text-foreground sm:truncate">
                                  {c.title}
                                </span>
                                <span className="hidden text-xs text-muted-foreground flex-shrink-0 sm:inline">
                                  ({c.credits}cr)
                                </span>
                              </div>
                              <Select
                                value={guess ?? NO_GUESS}
                                onValueChange={(val) =>
                                  setGuess(c.courseId, val === NO_GUESS ? null : val)
                                }
                              >
                                <SelectTrigger
                                  className="w-24 h-8"
                                  aria-label={`Expected grade for ${c.code}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NO_GUESS}>—</SelectItem>
                                  {GRADE_OPTIONS.map((g) => (
                                    <SelectItem key={g} value={g}>
                                      {g}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </SectionCard>
            )}

            {renderProjectionsCard()}

            <SectionCard
              title="Edit past module grades"
              description="Pick a different grade for any course to see what it would change."
              bodyClassName="space-y-4"
            >
                {coursesBySemester.map((group) => {
                  const semStanding = simulatedStanding.semesterGpas.find(
                    (s) => s.semester === group.semester,
                  );
                  const actualSemStanding = actualStanding.semesterGpas.find(
                    (s) => s.semester === group.semester,
                  );
                  const changed =
                    semStanding &&
                    actualSemStanding &&
                    semStanding.sgpa !== actualSemStanding.sgpa;
                  return (
                    <div key={group.semester}>
                      <div className="flex items-center gap-2 mb-3">
                        <h4 className="font-semibold text-foreground">
                          Semester {group.semester}
                        </h4>
                        <StatusBadge tone={changed ? "brand" : "neutral"}>
                          SGPA: {semStanding?.sgpa.toFixed(2) ?? "0.00"}
                          {changed &&
                            ` (was ${actualSemStanding!.sgpa.toFixed(2)})`}
                        </StatusBadge>
                      </div>
                      <div className="space-y-2">
                        {group.courses.map((c) => {
                          const effectiveGrade =
                            simulatedGrades[c.resultRowId] ?? c.actualGrade;
                          const isChanged =
                            simulatedGrades[c.resultRowId] &&
                            simulatedGrades[c.resultRowId] !== c.actualGrade;
                          return (
                            <div
                              key={c.resultRowId}
                              className={cn(
                                "flex items-center justify-between gap-3 rounded-lg border-l-4 p-2.5 transition-colors",
                                departmentByCourseCode(c.code)?.stripeClass ?? "border-l-transparent",
                                // A simulated grade keeps its own highlight;
                                // otherwise the department's tint on hover.
                                isChanged
                                  ? "bg-primary/5 ring-1 ring-inset ring-primary/20"
                                  : cn("bg-muted/30", departmentByCourseCode(c.code)?.hoverClass),
                              )}
                            >
                              {/* On a phone the title takes its own line
                                  under the code, rather than being cut off
                                  beside it. */}
                              <div className="flex min-w-0 flex-col gap-x-2 sm:flex-row sm:items-center">
                                <span className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "text-xs font-semibold tabular-nums flex-shrink-0",
                                      departmentByCourseCode(c.code)?.textClass ??
                                        "text-foreground",
                                    )}
                                  >
                                    {c.code}
                                  </span>
                                  <span className="text-xs text-muted-foreground sm:hidden">
                                    {c.credits} credit{c.credits === 1 ? "" : "s"}
                                  </span>
                                </span>
                                <span className="text-sm text-foreground sm:truncate">
                                  {c.title}
                                </span>
                                <span className="hidden text-xs text-muted-foreground flex-shrink-0 sm:inline">
                                  ({c.credits}cr)
                                </span>
                              </div>
                              <Select
                                value={effectiveGrade ?? undefined}
                                onValueChange={(val) =>
                                  setSimulatedGrades((prev) => ({
                                    ...prev,
                                    [c.resultRowId]: val,
                                  }))
                                }
                              >
                                <SelectTrigger
                                  className="w-24 h-8"
                                  aria-label={`Grade for ${c.code}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {GRADE_OPTIONS.map((g) => (
                                    <SelectItem key={g} value={g}>
                                      {g}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
