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
  Target,
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
  ErrorState,
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
import {
  bestPossibleCgpa,
  capGrades,
  classTargets,
  computeStanding,
  expectableGrades,
  gradeCap,
  isGradedNow,
  openSemesters,
  orderedGrades,
  parsePlan,
  type ClassTarget,
  type GraduationPlan,
  type OpenSemester,
  type PlanResult,
  type SittingCourse,
} from "../../lib/graduationPlan";

/** The "—" choice: no guess, so the course is not counted. */
const NO_GUESS = "__none__";
/** The "Auto" choice: no plan, so the semester takes the shared target. */
const NO_PLAN = "__auto__";
/** SGPAs a student can plan a semester at, 4.00 down to 2.00. */
const PLAN_OPTIONS = Array.from({ length: 21 }, (_, i) => (4 - i / 10).toFixed(2));

const classificationForGpa = (gpa: number): string => {
  const match = getSettings().honoursClassifications.find(
    (c) => gpa >= c.threshold,
  );
  return match?.label ?? "Below Pass";
};

/* The short names the class picker has room for. */
const SHORT_CLASS: Record<string, string> = {
  first: "First",
  second_upper: "Second Upper",
  second_lower: "Second Lower",
  pass: "Pass",
};

/* Guesses and plans stay in this browser. They are the student's own
   what-ifs, never sent anywhere, and kept only so they survive a reload. */
const storeKey = (kind: "guesses" | "plans", studentId: string) =>
  `pes.planner.${kind}.${studentId}`;
function load<T extends object>(kind: "guesses" | "plans", studentId: string): T | Record<string, never> {
  try {
    const raw = window.localStorage.getItem(storeKey(kind, studentId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function save(kind: "guesses" | "plans", studentId: string, value: object) {
  try {
    if (Object.keys(value).length === 0) window.localStorage.removeItem(storeKey(kind, studentId));
    else window.localStorage.setItem(storeKey(kind, studentId), JSON.stringify(value));
  } catch {
    /* Private window or blocked storage: the what-ifs just don't persist. */
  }
}

const andList = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export default function GraduationPlanner() {
  const { student } = useAuth();
  const settings = useSettings();
  const GPV = settings.gpvScale;
  const PAST_GRADES = useMemo(() => orderedGrades(GPV), [GPV]);
  const EXPECTABLE = useMemo(() => expectableGrades(GPV), [GPV]);
  const CLASSIFICATIONS = settings.honoursClassifications;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<PlanResult[]>([]);
  const [plan, setPlan] = useState<GraduationPlan | null>(null);
  // Past grades the student is trying differently, keyed by result row.
  const [simulatedGrades, setSimulatedGrades] = useState<Record<string, string>>({});
  // Grades expected in courses being sat now, keyed by course.
  const [guessedGrades, setGuessedGrades] = useState<Record<string, string>>({});
  // SGPAs the student plans for a remaining semester, keyed by semester.
  const [plannedSgpa, setPlannedSgpa] = useState<Record<number, number>>({});
  const [activeTab, setActiveTab] = useState("standing");
  const [targetClass, setTargetClass] = useState<string | null>(null);

  useEffect(() => {
    if (!student?.id) return;
    fetchData();
  }, [student?.id]);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);

    /* The record (each result weighted by the credits it carries, both parts
       of a two-semester course included) and the plan: what is being sat
       now and the GPA credits every remaining semester will carry. */
    const [{ data: rows, error: rowsError }, { data: rawPlan, error: planError }] =
      await Promise.all([
        supabase
          .from("my_published_results")
          .select(
            "id, grade, gpv, course_id, course_code, course_title, semester, credits, contributes_to_gpa",
          )
          .not("gpv", "is", null),
        supabase.rpc("get_my_graduation_plan"),
      ]);

    if (rowsError || planError) {
      console.error("[GraduationPlanner] failed to load", rowsError ?? planError);
      setLoadError("We could not load your record. Please try again.");
      setLoading(false);
      return;
    }

    const parsed = parsePlan(rawPlan);
    setPlan(parsed);
    setResults(
      (rows ?? []).map((r: any) => ({
        resultRowId: r.id,
        courseId: r.course_id,
        code: r.course_code,
        title: r.course_title,
        semester: r.semester,
        credits: r.credits,
        contributesToGpa: r.contributes_to_gpa,
        grade: r.grade,
        gpv: r.gpv,
      })),
    );

    // Saved what-ifs, as long as they still fit what is being sat.
    const saved = load<Record<string, string>>("guesses", student!.id);
    setGuessedGrades(
      Object.fromEntries(
        Object.entries(saved).filter(([id, g]) => {
          const c = parsed.courses.find((x) => x.courseId === id);
          return (
            c && isGradedNow(c) &&
            capGrades(EXPECTABLE, gradeCap(c, parsed.resitMaxGrade), GPV).includes(g as string)
          );
        }),
      ) as Record<string, string>,
    );
    const savedPlans = load<Record<string, number>>("plans", student!.id);
    setPlannedSgpa(
      Object.fromEntries(
        Object.entries(savedPlans)
          .map(([s, v]) => [Number(s), Number(v)] as const)
          .filter(([s, v]) => parsed.semesters.some((x) => x.semester === s) && v >= 0 && v <= 4),
      ),
    );

    setLoading(false);
  };

  const sitting = plan?.courses ?? [];

  const actualStanding = useMemo(() => computeStanding(results, GPV), [results, GPV]);
  const simulatedStanding = useMemo(
    () => computeStanding(results, GPV, simulatedGrades, sitting, guessedGrades),
    [results, GPV, simulatedGrades, sitting, guessedGrades],
  );

  const simulator = activeTab === "simulator";
  const standing = simulator ? simulatedStanding : actualStanding;
  const open: OpenSemester[] = useMemo(
    () => (plan ? openSemesters(plan, standing, simulator ? plannedSgpa : {}) : []),
    [plan, standing, simulator, plannedSgpa],
  );
  const openCredits = open.reduce((n, s) => n + s.openCredits, 0);
  const targets = useMemo(
    () => classTargets(standing, open, CLASSIFICATIONS),
    [standing, open, CLASSIFICATIONS],
  );
  const best = bestPossibleCgpa(standing, open);

  // The class the semester targets open on: the best one still within reach
  // and not already secured, else the one the student is in.
  const defaultClass = useMemo(() => {
    const reachable = targets.find((t) => !t.alreadySecured && t.feasible);
    return (reachable ?? targets.find((t) => t.alreadySecured) ?? targets[0])?.key ?? null;
  }, [targets]);
  const selectedClass = targets.find((t) => t.key === (targetClass ?? defaultClass)) ?? targets[0];

  // Courses being sat now, by semester, with repeats of earlier courses in a
  // group of their own. A course that does not count towards the GPA cannot
  // move it, so it is left out.
  const sittingGroups = useMemo(() => {
    const bySem: Record<number, SittingCourse[]> = {};
    const repeats: SittingCourse[] = [];
    sitting
      .filter((c) => c.contributesToGpa)
      .forEach((c) => {
        if (c.previous) repeats.push(c);
        else (bySem[c.semester] ??= []).push(c);
      });
    const groups: { key: string; semester: number | null; courses: SittingCourse[] }[] = Object.entries(bySem)
      .map(([sem, courses]) => ({ key: `s${sem}`, semester: Number(sem), courses }))
      .sort((a, b) => (a.semester ?? 0) - (b.semester ?? 0));
    if (repeats.length > 0) groups.push({ key: "repeats", semester: null, courses: repeats });
    return groups;
  }, [sitting]);
  // The semester being sat, as the plan has it (a repeat is not one).
  const sittingSemesters = (plan?.semesters ?? [])
    .filter((s) => s.source === "enrolled")
    .map((s) => s.semester);

  const guessCount = Object.keys(guessedGrades).length;
  const planCount = Object.keys(plannedSgpa).length;
  const hasSimulation =
    Object.keys(simulatedGrades).length > 0 || guessCount > 0 || planCount > 0;

  const setGuess = (courseId: string, grade: string | null) => {
    setGuessedGrades((prev) => {
      const next = { ...prev };
      if (grade) next[courseId] = grade;
      else delete next[courseId];
      if (student?.id) save("guesses", student.id, next);
      return next;
    });
  };

  const setPlanFor = (semester: number, sgpa: number | null) => {
    setPlannedSgpa((prev) => {
      const next = { ...prev };
      if (sgpa === null) delete next[semester];
      else next[semester] = sgpa;
      if (student?.id) save("plans", student.id, next);
      return next;
    });
  };

  const resetSimulation = () => {
    setSimulatedGrades({});
    setGuessedGrades({});
    setPlannedSgpa({});
    if (student?.id) {
      save("guesses", student.id, {});
      save("plans", student.id, {});
    }
  };

  const pastBySemester = useMemo(() => {
    const groups: Record<number, PlanResult[]> = {};
    results
      .filter((c) => c.contributesToGpa)
      .forEach((c) => {
        (groups[c.semester] ??= []).push(c);
      });
    return Object.entries(groups)
      .map(([sem, courses]) => ({ semester: Number(sem), courses }))
      .sort((a, b) => a.semester - b.semester);
  }, [results]);

  /* "Semester 7 (20 credits) and Semester 8 (17 credits)": what is left to
     decide, and which semesters the student has already planned. */
  const remainingText = andList(
    open
      .filter((s) => s.openCredits > 0 && s.planned === null)
      .map((s) => `Semester ${s.semester} (${s.openCredits} credits)`),
  );
  const plannedText = andList(
    open
      .filter((s) => s.planned !== null)
      .map((s) => `Semester ${s.semester} at ${s.planned!.toFixed(2)}`),
  );

  const renderStandingCards = () => {
    const projected = simulator && hasSimulation;
    const finalCredits = standing.credits + openCredits;
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          index={0}
          label={projected ? "Projected CGPA" : "Current CGPA"}
          value={standing.cgpa.toFixed(2)}
          icon={Award}
          tone="brand"
          hint={
            projected
              ? `${classificationForGpa(standing.cgpa)} · now ${actualStanding.cgpa.toFixed(2)}`
              : classificationForGpa(standing.cgpa)
          }
        />
        <StatCard
          index={1}
          label="GPA credits so far"
          value={standing.credits}
          icon={GraduationCap}
          tone="neutral"
          hint={
            projected && standing.guessedNewCredits > 0
              ? `including ${standing.guessedNewCredits} you guessed · of ${finalCredits}`
              : `of ${finalCredits} in your degree`
          }
        />
        <StatCard
          index={2}
          label="GPA credits to go"
          value={openCredits}
          icon={Hourglass}
          tone="info"
          hint={
            open.filter((s) => s.openCredits > 0).length > 0
              ? `Semester ${andList(open.filter((s) => s.openCredits > 0).map((s) => String(s.semester)))}`
              : undefined
          }
        />
        <StatCard
          index={3}
          label="Best possible CGPA"
          value={best.toFixed(2)}
          icon={TrendingUp}
          tone="success"
          hint="With an A+ in every remaining course"
        />
      </div>
    );
  };

  const verdictBadge = (t: ClassTarget) =>
    t.alreadySecured ? (
      <StatusBadge tone="success" dot>Secured</StatusBadge>
    ) : !t.feasible ? (
      <StatusBadge tone="danger" dot>Not achievable</StatusBadge>
    ) : t.required >= 3.8 ? (
      <StatusBadge tone="warning" dot>Challenging</StatusBadge>
    ) : (
      <StatusBadge tone="info" dot>On track</StatusBadge>
    );

  /* What each class needs, as one average over everything still open. */
  const renderProjectionsCard = () => (
    <SectionCard
      title="What you need for each class"
      description={
        [
          remainingText
            ? `The average your remaining GPA credits must reach: ${remainingText}.`
            : "The average your remaining GPA credits must reach.",
          plannedText ? `With ${plannedText} as planned.` : "",
        ].join(" ")
      }
      bodyClassName="space-y-2.5"
    >
      {targets.map((t) => (
        <div
          key={t.key}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border p-3"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-foreground">{t.label}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                CGPA ≥ {t.threshold.toFixed(2)}
              </span>
            </div>
            {t.alreadySecured ? (
              <p className="mt-1 flex items-center gap-1 text-sm text-success-fg">
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                Already secured: even a 0.00 average in your remaining{" "}
                {t.freeCredits} credits keeps you above this.
              </p>
            ) : !t.feasible ? (
              <p className="mt-1 flex items-center gap-1 text-sm text-danger-fg">
                <XCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {t.freeCredits > 0
                  ? "No longer reachable: it would need more than a 4.00 average."
                  : "Not reached with what you have planned."}
              </p>
            ) : t.freeCredits === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Reached with what you have planned.</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Average{" "}
                <strong className="text-lg font-bold text-foreground tabular-nums">
                  {Math.max(0, t.required).toFixed(2)}
                </strong>{" "}
                across your remaining {t.freeCredits} credits
              </p>
            )}
          </div>
          {verdictBadge(t)}
        </div>
      ))}
    </SectionCard>
  );

  /* The same target, semester by semester. Each semester counts in
     proportion to its GPA credits, so a heavier one moves the CGPA more:
     planning one semester higher lowers what the others need by its weight. */
  const renderSemesterTargets = () => {
    const t = selectedClass;
    if (!t || open.length === 0) return null;
    const totalOpen = openCredits;
    return (
      <SectionCard
        title="Semester targets"
        description={
          simulator
            ? "The SGPA each remaining semester needs for the class you pick. A semester counts in proportion to its GPA credits: plan one higher and the others need less."
            : "The SGPA each remaining semester needs for the class you pick. A semester counts in proportion to its GPA credits. To plan one semester higher than another, use the What-If Simulator."
        }
        bodyClassName="space-y-3"
      >
        <SegmentedTabs
          tabs={CLASSIFICATIONS.map((c) => ({ value: c.key, label: SHORT_CLASS[c.key] ?? c.label }))}
          value={t.key}
          onChange={setTargetClass}
          layoutId={`planner-class-${activeTab}`}
          aria-label="Class to plan for"
          equal
          // Four equal tabs as wide as "Second Upper" do not fit a phone:
          // there they sit two by two.
          className="max-sm:w-full max-sm:grid-cols-2!"
        />
        <p className="text-sm text-muted-foreground">
          {t.label} needs a final CGPA of {t.threshold.toFixed(2)} over your{" "}
          {t.finalCredits} GPA credits.
        </p>

        <ul className="space-y-2">
          {open.map((s) => {
            const sem = standing.semesterGpas.find((g) => g.semester === s.semester);
            const weight = totalOpen > 0 ? Math.round((s.openCredits / totalOpen) * 100) : 0;
            const allGuessed = s.openCredits === 0;
            return (
              <li
                key={s.semester}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-foreground">Semester {s.semester}</h3>
                    {s.source === "enrolled" ? (
                      <StatusBadge tone="brand">In progress</StatusBadge>
                    ) : s.source === "estimate" ? (
                      <StatusBadge tone="neutral">Estimated</StatusBadge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {s.credits} GPA credits
                    {s.source === "enrolled"
                      ? " from your enrolment"
                      : s.source === "curriculum"
                        ? " in the handbook curriculum"
                        : ""}
                    {s.guessedCredits > 0 &&
                      ` · ${s.guessedCredits} guessed${sem ? ` (SGPA ${sem.sgpa.toFixed(2)})` : ""}, ${s.openCredits} open`}
                    {!allGuessed && totalOpen > 0 && ` · ${weight}% of what is left`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {allGuessed ? (
                    <span className="text-sm text-muted-foreground">All guessed</span>
                  ) : s.planned !== null ? (
                    <span className="text-sm text-muted-foreground">
                      Planned{" "}
                      <strong className="text-lg font-bold text-foreground tabular-nums">
                        {s.planned.toFixed(2)}
                      </strong>
                    </span>
                  ) : t.alreadySecured ? (
                    <StatusBadge tone="success" dot>Secured</StatusBadge>
                  ) : !t.feasible ? (
                    <span className="text-sm font-semibold text-danger-fg">Above 4.00</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      SGPA{" "}
                      <strong className="text-lg font-bold text-foreground tabular-nums">
                        {Math.max(0, t.required).toFixed(2)}
                      </strong>
                    </span>
                  )}
                  {simulator && !allGuessed && (
                    <Select
                      value={s.planned !== null ? s.planned.toFixed(2) : NO_PLAN}
                      onValueChange={(v) => setPlanFor(s.semester, v === NO_PLAN ? null : Number(v))}
                    >
                      <SelectTrigger className="h-8 w-32" aria-label={`Plan an SGPA for Semester ${s.semester}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_PLAN}>Auto</SelectItem>
                        {PLAN_OPTIONS.map((v) => (
                          <SelectItem key={v} value={v}>
                            Plan {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {t.plannedFinalCgpa !== null && (
          <p className="rounded-xl bg-primary/5 p-3 text-sm text-foreground ring-1 ring-inset ring-primary/20">
            With these plans you finish on a CGPA of{" "}
            <strong className="tabular-nums">{t.plannedFinalCgpa.toFixed(2)}</strong>:{" "}
            {classificationForGpa(t.plannedFinalCgpa)}.
          </p>
        )}

        {!simulator && sittingSemesters.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              Semester {andList(sittingSemesters.map(String))} is in progress. Put in the
              grades you expect and see your CGPA with them.
            </p>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("simulator")}>
              <ClipboardPen className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Guess this semester's grades
            </Button>
          </div>
        )}
      </SectionCard>
    );
  };

  /* A course being sat now, as its row explains it: a part graded later, a
     final part worth both, or a repeat that replaces an earlier grade. */
  const sittingNote = (c: SittingCourse) => {
    if (c.gradedIn)
      return `Graded with ${c.gradedIn.code} in Semester ${c.gradedIn.semester}, for ${c.gradedIn.credits} credits`;
    if (c.earlierParts.length > 0) {
      const parts = c.earlierParts.map((p) => `${p.credits} from Semester ${p.semester}`).join(" + ");
      return `${c.resultCredits} credits: ${parts} + ${c.credits} this semester`;
    }
    if (c.previous) {
      const cap = gradeCap(c, plan?.resitMaxGrade ?? "C");
      return `Semester ${c.semester} course: replaces your ${c.previous.grade ?? "earlier grade"}${cap ? `, up to ${cap}` : ""}`;
    }
    return null;
  };

  const renderSittingCard = () =>
    sittingGroups.length > 0 && (
      <SectionCard
        title="This semester's courses"
        description="No results yet. Pick the grade you expect in each; a course left at “—” is not counted. Your guesses stay on this device."
        bodyClassName="space-y-4"
      >
        {sittingGroups.map((group) => {
          const gradable = group.courses.filter(isGradedNow);
          const guessed = gradable.filter((c) => guessedGrades[c.courseId]);
          const sem =
            group.semester !== null
              ? simulatedStanding.semesterGpas.find((s) => s.semester === group.semester)
              : undefined;
          return (
            <div key={group.key}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-foreground">
                  {group.semester !== null
                    ? `Semester ${group.semester} — in progress`
                    : "Repeating"}
                </h4>
                {group.semester !== null && (
                  <StatusBadge tone={guessed.length > 0 ? "brand" : "neutral"}>
                    {guessed.length > 0 && sem
                      ? `Projected SGPA: ${sem.sgpa.toFixed(2)}`
                      : "Pick grades to see your SGPA"}
                  </StatusBadge>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {guessed.length} of {gradable.length} guessed
                </span>
              </div>
              <div className="space-y-2">
                {group.courses.map((c) => {
                  const guess = guessedGrades[c.courseId];
                  const dept = departmentByCourseCode(c.code);
                  const note = sittingNote(c);
                  const credits = c.gradedIn ? c.credits : c.resultCredits;
                  const options = capGrades(EXPECTABLE, gradeCap(c, plan?.resitMaxGrade ?? "C"), GPV);
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
                      <div className="min-w-0">
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
                              {credits} credit{credits === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="text-sm text-foreground sm:truncate">{c.title}</span>
                          <span className="hidden text-xs text-muted-foreground flex-shrink-0 sm:inline">
                            ({credits}cr)
                          </span>
                        </div>
                        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
                      </div>
                      {isGradedNow(c) ? (
                        <Select
                          value={guess ?? NO_GUESS}
                          onValueChange={(val) => setGuess(c.courseId, val === NO_GUESS ? null : val)}
                        >
                          <SelectTrigger className="w-24 h-8 flex-shrink-0" aria-label={`Expected grade for ${c.code}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_GUESS}>—</SelectItem>
                            {options.map((g) => (
                              <SelectItem key={g} value={g}>
                                {g}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="flex-shrink-0 text-xs text-muted-foreground">No grade yet</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </SectionCard>
    );

  const finished = !loading && plan !== null && openCredits === 0 && sitting.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Graduation Planner"
        description="See what SGPA you need in each remaining semester, or try grades for this semester and see what they would change."
      />

      {loading ? (
        <div className="space-y-4">
          <SkeletonStatGrid count={4} />
          <SkeletonRows count={4} height="h-16" />
        </div>
      ) : loadError ? (
        <ErrorState title="The planner could not load" message={loadError} onRetry={fetchData} />
      ) : finished ? (
        <SectionCard>
          <EmptyState
            icon={CheckCircle2}
            title="Every course of your degree has a result"
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
            {renderStandingCards()}
            {renderSemesterTargets()}
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
                  {sittingSemesters.length > 0
                    ? "Put in the grades you expect this semester, plan an SGPA for a semester ahead, or change a past grade."
                    : "Plan an SGPA for a semester ahead, or change a past grade."}{" "}
                  These are projections only —{" "}
                  <strong>nothing here changes your real academic record.</strong>
                </p>
              </div>
              {hasSimulation && (
                <Button variant="outline" size="sm" onClick={resetSimulation}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reset to actual results
                </Button>
              )}
            </motion.div>

            {renderStandingCards()}
            {renderSittingCard()}
            {renderSemesterTargets()}
            {renderProjectionsCard()}

            <SectionCard
              title="Edit past module grades"
              description="Pick a different grade for any course to see what it would change."
              bodyClassName="space-y-4"
            >
              {pastBySemester.length === 0 && (
                <EmptyState icon={Target} title="No published results yet" size="inline" />
              )}
              {pastBySemester.map((group) => {
                const semStanding = simulatedStanding.semesterGpas.find(
                  (s) => s.semester === group.semester,
                );
                const actualSemStanding = actualStanding.semesterGpas.find(
                  (s) => s.semester === group.semester,
                );
                const changed =
                  semStanding && actualSemStanding && semStanding.sgpa !== actualSemStanding.sgpa;
                return (
                  <div key={group.semester}>
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="font-semibold text-foreground">Semester {group.semester}</h4>
                      <StatusBadge tone={changed ? "brand" : "neutral"}>
                        SGPA: {semStanding?.sgpa.toFixed(2) ?? "0.00"}
                        {changed && ` (was ${actualSemStanding!.sgpa.toFixed(2)})`}
                      </StatusBadge>
                    </div>
                    <div className="space-y-2">
                      {group.courses.map((c) => {
                        const effectiveGrade = simulatedGrades[c.resultRowId] ?? c.grade;
                        const isChanged =
                          simulatedGrades[c.resultRowId] &&
                          simulatedGrades[c.resultRowId] !== c.grade;
                        const dept = departmentByCourseCode(c.code);
                        return (
                          <div
                            key={c.resultRowId}
                            className={cn(
                              "flex items-center justify-between gap-3 rounded-lg border-l-4 p-2.5 transition-colors",
                              dept?.stripeClass ?? "border-l-transparent",
                              // A simulated grade keeps its own highlight;
                              // otherwise the department's tint on hover.
                              isChanged
                                ? "bg-primary/5 ring-1 ring-inset ring-primary/20"
                                : cn("bg-muted/30", dept?.hoverClass),
                            )}
                          >
                            {/* On a phone the title takes its own line under
                                the code, rather than being cut off beside it. */}
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
                              <span className="text-sm text-foreground sm:truncate">{c.title}</span>
                              <span className="hidden text-xs text-muted-foreground flex-shrink-0 sm:inline">
                                ({c.credits}cr)
                              </span>
                            </div>
                            <Select
                              value={effectiveGrade ?? undefined}
                              onValueChange={(val) =>
                                setSimulatedGrades((prev) => ({ ...prev, [c.resultRowId]: val }))
                              }
                            >
                              <SelectTrigger className="w-24 h-8 flex-shrink-0" aria-label={`Grade for ${c.code}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PAST_GRADES.map((g) => (
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
