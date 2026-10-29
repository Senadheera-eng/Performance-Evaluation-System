import { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardPen,
  FlaskConical,
  GraduationCap,
  Hourglass,
  Medal,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Target,
  TrendingUp,
  Users,
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
import { Input } from "../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { CgpaPathChart } from "../components/planner/CgpaPathChart";
import {
  AnimatedBar,
  AnimatedNumber,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonHero,
  SkeletonRows,
  StatStrip,
  StatusBadge,
  TabPanel,
  cardReveal,
  useExpandMotion,
} from "../components/common";
import { cn } from "../components/ui/utils";
import { departmentByCourseCode } from "../../lib/departments";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useSettings, getSettings } from "../../lib/settings";
import {
  bestPossibleCgpa,
  capGrades,
  cgpaPath,
  gradeMix,
  classTargets,
  computeStanding,
  expectableGrades,
  gradeCap,
  isGradedNow,
  DEANS_LIST_SGPA,
  GOLD_MEDAL_OGPA,
  gradeImpact,
  targetWorking,
  OUTSTANDING_LABEL,
  openSemesters,
  orderedGrades,
  parsePlan,
  type ClassTarget,
  type GraduationPlan,
  type OpenSemester,
  type PlanResult,
  type SittingCourse,
} from "../../lib/graduationPlan";
import {
  createScenario,
  deleteScenario,
  getAim,
  listScenarios,
  saveAim,
  shareScenario,
  updateScenario,
  type PlannerScenario,
  type ScenarioContent,
} from "../../lib/plannerScenarios";
import { getMyMentor } from "../../lib/mentorService";

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

/* What-ifs are saved with the student's account, as scenarios. This browser
   only remembers which scenario was open last, and once hands over the
   what-ifs it kept before scenarios existed. Storage can be blocked (a
   private window), so every read and write is allowed to fail quietly. */
const legacyKey = (kind: "guesses" | "plans", studentId: string) =>
  `pes.planner.${kind}.${studentId}`;
const activeKey = (studentId: string) => `pes.planner.scenario.${studentId}`;
function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Blocked storage: the open scenario is just not remembered. */
  }
}
const isEmptyContent = (c: ScenarioContent) =>
  Object.keys(c.guesses).length + Object.keys(c.plans).length + Object.keys(c.past).length === 0;

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
  /* Semesters opened by hand under "Edit past module grades". */
  const [pastOpen, setPastOpen] = useState<Record<number, boolean>>({});
  const reduce = useReducedMotion();
  const expand = useExpandMotion();
  const [targetClass, setTargetClass] = useState<string | null>(null);
  // A long list of modules to clear opens folded.
  const [showAllToClear, setShowAllToClear] = useState(false);
  // Saved scenarios, the one open, and how its saving is going.
  const [scenarios, setScenarios] = useState<PlannerScenario[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<null | { mode: "new" | "rename"; value: string }>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The mentor a scenario can be shared with; null when there is none.
  const [mentorName, setMentorName] = useState<string | null>(null);
  const pendingAim = useRef<{ timer: number; run: () => void } | null>(null);
  // A scenario being opened is not a change to save; and nothing is saved
  // before the page has loaded what it would be saving over.
  const applying = useRef(false);
  const ready = useRef(false);
  // A change waiting to be saved: its timer, and the save itself, so leaving
  // the page can send it at once rather than drop it.
  const pending = useRef<{ timer: number; target: string | null; run: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!student?.id) return;
    fetchData();
    getMyMentor().then((r) => setMentorName(r.ok ? (r.data?.name ?? null) : null));
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

    const parsedRows: PlanResult[] = (rows ?? []).map((r: any) => ({
      resultRowId: r.id,
      courseId: r.course_id,
      code: r.course_code,
      title: r.course_title,
      semester: r.semester,
      credits: r.credits,
      contributesToGpa: r.contributes_to_gpa,
      grade: r.grade,
      gpv: r.gpv,
    }));

    /* Saved scenarios. The one opened last on this device, else the newest.
       What-ifs this browser kept before scenarios existed become the first
       one, "My plan", and are then cleared from the browser. */
    const [{ data: saved }, aim] = await Promise.all([listScenarios(), getAim()]);
    if (aim && CLASSIFICATIONS.some((c) => c.key === aim)) setTargetClass(aim);
    let list = saved;
    if (list.length === 0) {
      const legacy: ScenarioContent = {
        guesses: readStore(legacyKey("guesses", student!.id), {}),
        plans: readStore(legacyKey("plans", student!.id), {}),
        past: {},
      };
      const clean = sanitize(legacy, parsed, parsedRows);
      if (!isEmptyContent(clean)) {
        const { data: created } = await createScenario("My plan", clean);
        if (created) list = [created];
      }
      writeStore(legacyKey("guesses", student!.id), null);
      writeStore(legacyKey("plans", student!.id), null);
    }
    setScenarios(list);
    const remembered = readStore<string | null>(activeKey(student!.id), null);
    const open =
      list.find((x) => x.id === remembered) ??
      [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    applyContent(open ? sanitize(open, parsed, parsedRows) : { guesses: {}, plans: {}, past: {} });
    setActiveId(open?.id ?? null);

    setResults(parsedRows);
    setLoading(false);
    ready.current = true;
  };

  /** A scenario's what-ifs, keeping only those that still fit the record:
   *  a course still being sat or to clear, a grade it can still get, a
   *  semester still ahead, a result still on the record. */
  const sanitize = (
    c: ScenarioContent,
    p: GraduationPlan,
    rows: PlanResult[],
  ): ScenarioContent => ({
    guesses: Object.fromEntries(
      Object.entries(c.guesses ?? {}).filter(([id, g]) => {
        const course = [...p.courses, ...p.outstanding].find((x) => x.courseId === id);
        return (
          course && isGradedNow(course) &&
          capGrades(EXPECTABLE, gradeCap(course, p.resitMaxGrade), GPV).includes(g)
        );
      }),
    ),
    plans: Object.fromEntries(
      Object.entries(c.plans ?? {}).filter(
        ([sem, v]) => p.semesters.some((x) => x.semester === Number(sem)) && Number(v) >= 0 && Number(v) <= 4,
      ),
    ),
    past: Object.fromEntries(
      Object.entries(c.past ?? {}).filter(([id, g]) => rows.some((r) => r.resultRowId === id) && g in GPV),
    ),
  });

  /** Open a set of what-ifs without that counting as a change to save. */
  const applyContent = (c: ScenarioContent) => {
    applying.current = true;
    setGuessedGrades(c.guesses);
    setPlannedSgpa(Object.fromEntries(Object.entries(c.plans).map(([k, v]) => [Number(k), Number(v)])));
    setSimulatedGrades(c.past);
  };

  const sitting = useMemo(
    () => [...(plan?.courses ?? []), ...(plan?.outstanding ?? [])],
    [plan],
  );

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

  // Courses being sat now, by semester, then everything still to clear
  // (repeats and earlier F, R or L grades) in a group of its own. A course
  // that does not count towards the GPA cannot move it, so it is left out.
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
  const toClear = plan?.outstanding ?? [];
  const gpaToClear = toClear.filter((c) => c.contributesToGpa);
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
      return next;
    });
  };

  const setPlanFor = (semester: number, sgpa: number | null) => {
    setPlannedSgpa((prev) => {
      const next = { ...prev };
      if (sgpa === null) delete next[semester];
      else next[semester] = sgpa;
      return next;
    });
  };

  const resetSimulation = () => {
    setSimulatedGrades({});
    setGuessedGrades({});
    setPlannedSgpa({});
  };

  const currentContent = (): ScenarioContent => ({
    guesses: guessedGrades,
    plans: Object.fromEntries(Object.entries(plannedSgpa).map(([k, v]) => [String(k), v])),
    past: simulatedGrades,
  });

  /* Every change is saved to the open scenario a moment after it is made.
     The first change, with no scenario yet, starts one called "My plan".
     A save waiting when another scenario is opened still goes to the one it
     was made in. */
  useEffect(() => {
    if (!ready.current) return;
    if (applying.current) {
      applying.current = false;
      return;
    }
    const content = currentContent();
    const target = activeId;
    const run = async () => {
      pending.current = null;
      setSaveState("saving");
      setScenarioError(null);
      if (target) {
        const { data, error } = await updateScenario(target, content);
        if (error || !data) {
          setSaveState("error");
          setScenarioError(error);
          return;
        }
        setScenarios((list) => list.map((x) => (x.id === data.id ? data : x)));
      } else if (!isEmptyContent(content)) {
        const { data, error } = await createScenario("My plan", content);
        if (error || !data) {
          setSaveState("error");
          setScenarioError(error);
          return;
        }
        setScenarios((list) => [...list, data]);
        setActiveId(data.id);
        if (student?.id) writeStore(activeKey(student.id), data.id);
      } else {
        setSaveState("idle");
        return;
      }
      setSaveState("saved");
    };
    if (pending.current) {
      window.clearTimeout(pending.current.timer);
      // A newer change to the same scenario replaces it; one for another
      // scenario is sent now.
      if (pending.current.target !== target) void pending.current.run();
    }
    pending.current = { timer: window.setTimeout(run, 700), target, run };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guessedGrades, plannedSgpa, simulatedGrades]);

  // Leaving the page sends a waiting save straight away.
  useEffect(
    () => () => {
      if (pending.current) {
        window.clearTimeout(pending.current.timer);
        void pending.current.run();
      }
      if (pendingAim.current) {
        window.clearTimeout(pendingAim.current.timer);
        pendingAim.current.run();
      }
    },
    [],
  );

  const openScenario = (id: string) => {
    const sc = scenarios.find((x) => x.id === id);
    if (!sc || !plan) return;
    applyContent(sanitize(sc, plan, results));
    setActiveId(id);
    setSaveState("idle");
    if (student?.id) writeStore(activeKey(student.id), id);
  };

  /* New: a copy of the what-ifs on screen, under a new name. Rename: the
     open one. Both through the same small dialog. */
  const submitName = async () => {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (!name) return;
    setScenarioError(null);
    if (nameDialog.mode === "new") {
      const { data, error } = await createScenario(name, currentContent());
      if (error || !data) return setScenarioError(error);
      setScenarios((list) => [...list, data]);
      setActiveId(data.id);
      if (student?.id) writeStore(activeKey(student.id), data.id);
    } else if (activeId) {
      const { data, error } = await updateScenario(activeId, { name });
      if (error || !data) return setScenarioError(error);
      setScenarios((list) => list.map((x) => (x.id === data.id ? data : x)));
    }
    setNameDialog(null);
  };

  /* The class picked in Semester targets is the one the student is aiming
     for: kept with their account (a moment after the last pick), so the
     planner opens on it and the notice after a semester's results speaks
     to it. */
  const pickClass = (key: string) => {
    setTargetClass(key);
    if (!student?.id) return;
    if (pendingAim.current) window.clearTimeout(pendingAim.current.timer);
    const id = student.id;
    const run = () => {
      pendingAim.current = null;
      void saveAim(id, key);
    };
    pendingAim.current = { timer: window.setTimeout(run, 800), run };
  };

  /* One scenario at a time is shared with the mentor, who sees it read-only
     with the class aimed for. */
  const toggleShare = async (sc: PlannerScenario) => {
    setScenarioError(null);
    const next = sc.sharedWithMentor ? null : sc.id;
    const { error } = await shareScenario(next);
    if (error) return setScenarioError(error);
    setScenarios((list) => list.map((x) => ({ ...x, sharedWithMentor: x.id === next })));
  };

  const removeScenario = async () => {
    if (!activeId) return;
    const { error } = await deleteScenario(activeId);
    setConfirmDelete(false);
    if (error) return setScenarioError(error);
    const rest = scenarios.filter((x) => x.id !== activeId);
    setScenarios(rest);
    const next = rest[rest.length - 1];
    if (next && plan) {
      applyContent(sanitize(next, plan, results));
      setActiveId(next.id);
      if (student?.id) writeStore(activeKey(student.id), next.id);
    } else {
      applyContent({ guesses: {}, plans: {}, past: {} });
      setActiveId(null);
      if (student?.id) writeStore(activeKey(student.id), null);
    }
    setSaveState("idle");
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

  /* The one thing the planner is for, first: the class the student is
     aiming at, and the SGPA it asks of what is left. The four numbers the
     page used to open with as cards sit along its foot. */
  const renderHero = () => {
    const t = selectedClass;
    const projected = simulator && hasSimulation;
    const finalCredits = standing.credits + openCredits;
    const toGo = open.filter((s) => s.openCredits > 0);
    const mix =
      t && t.feasible && !t.alreadySecured && t.freeCredits > 0
        ? gradeMix(Math.max(0, t.required), t.freeCredits, GPV)
        : null;
    return (
      <motion.section
        variants={cardReveal}
        initial={reduce ? false : "hidden"}
        animate="show"
        className="rounded-card border border-primary/15 surface-tint p-5 shadow-elevation-sm sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Aiming for
          </p>
          <SegmentedTabs
            tabs={CLASSIFICATIONS.map((c) => ({ value: c.key, label: SHORT_CLASS[c.key] ?? c.label }))}
            value={t?.key ?? ""}
            onChange={pickClass}
            layoutId={`planner-class-${activeTab}`}
            aria-label="Class to plan for"
            equal
            // Four equal tabs as wide as "Second Upper" do not fit a phone:
            // there they sit two by two.
            className="max-sm:w-full max-sm:grid-cols-2!"
          />
        </div>

        {t && (
          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
            <TabPanel value={t.key}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                {t.alreadySecured ? (
                  <span className="text-5xl font-bold leading-none tracking-tight text-success-fg">Secured</span>
                ) : !t.feasible ? (
                  <span className="text-5xl font-bold leading-none tracking-tight text-danger-fg">Out of reach</span>
                ) : t.freeCredits === 0 ? (
                  <span className="text-5xl font-bold leading-none tracking-tight text-foreground">Reached</span>
                ) : (
                  <>
                    <span className="text-base font-semibold text-muted-foreground">SGPA</span>
                    <span className="text-5xl font-bold leading-none tracking-tight tabular-nums text-foreground">
                      <AnimatedNumber value={Math.max(0, t.required)} decimals={2} />
                    </span>
                  </>
                )}
                {verdictBadge(t)}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t.alreadySecured
                  ? `${t.label}: even a 0.00 average in your remaining ${t.freeCredits} credits keeps you above ${t.threshold.toFixed(2)}.`
                  : !t.feasible
                    ? t.freeCredits > 0
                      ? `${t.label} would need more than a 4.00 average in your remaining ${t.freeCredits} credits.`
                      : `${t.label} is not reached with what you have planned.`
                    : t.freeCredits === 0
                      ? `${t.label} is reached with what you have planned.`
                      : `What ${t.label} needs on average across your remaining ${t.freeCredits} GPA credits${
                          toGo.length > 0 ? `, in Semester ${andList(toGo.map((x) => String(x.semester)))}` : ""
                        }.`}
              </p>
              {mix && <p className="mt-1 text-sm font-medium text-foreground">{mix}</p>}
              {t.plannedFinalCgpa !== null && (
                <p className="mt-1 text-sm text-foreground">
                  With your plans you finish on{" "}
                  <strong className="tabular-nums">{t.plannedFinalCgpa.toFixed(2)}</strong>:{" "}
                  {classificationForGpa(t.plannedFinalCgpa)}.
                </p>
              )}
            </TabPanel>
            <div>
              <AnimatedBar
                value={standing.cgpa}
                max={4}
                marker={t.threshold}
                tone={standing.cgpa >= t.threshold ? "success" : "brand"}
                label={`CGPA ${standing.cgpa.toFixed(2)} against ${t.threshold.toFixed(2)} for ${t.label}`}
              />
              <p className="mt-1.5 flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                <span>
                  {projected ? "Projected" : "CGPA"}{" "}
                  <strong className="text-foreground">{standing.cgpa.toFixed(2)}</strong>
                </span>
                <span>
                  {SHORT_CLASS[t.key] ?? t.label} at {t.threshold.toFixed(2)}
                </span>
              </p>
            </div>
          </div>
        )}

        <div className="mt-5 border-t border-border pt-4">
          <StatStrip
            items={[
              {
                label: `${projected ? "projected" : "current"} CGPA · ${classificationForGpa(standing.cgpa)}${
                  projected ? ` · now ${actualStanding.cgpa.toFixed(2)}` : ""
                }`,
                value: standing.cgpa.toFixed(2),
                icon: Award,
                tone: "brand",
              },
              {
                label:
                  projected && standing.guessedNewCredits > 0
                    ? `GPA credits so far, including ${standing.guessedNewCredits} you guessed · of ${finalCredits}`
                    : `GPA credits so far · of ${finalCredits} in your degree`,
                value: standing.credits,
                icon: GraduationCap,
              },
              {
                label:
                  toGo.length > 0
                    ? `GPA credits to go · Semester ${andList(toGo.map((x) => String(x.semester)))}`
                    : "GPA credits to go",
                value: openCredits,
                icon: Hourglass,
                tone: "info",
              },
              {
                label: "best possible CGPA, with an A+ in every remaining course",
                value: best.toFixed(2),
                icon: TrendingUp,
                tone: "success",
              },
            ]}
          />
        </div>
      </motion.section>
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
      collapsible
      defaultOpen={false}
      storageKey="planner-classes"
      summary={targets
        .map(
          (t) =>
            `${SHORT_CLASS[t.key] ?? t.label} ${
              t.alreadySecured ? "secured" : !t.feasible ? "out of reach" : Math.max(0, t.required).toFixed(2)
            }`,
        )
        .join(" · ")}
      description={
        [
          remainingText
            ? `The average your remaining GPA credits must reach: ${remainingText}.`
            : "The average your remaining GPA credits must reach.",
          plannedText ? `With ${plannedText} as planned.` : "",
          gpaToClear.some((c) => !(simulator && guessedGrades[c.courseId]))
            ? "A module still to clear counts as 0 until you pass it."
            : "",
        ].join(" ")
      }
      bodyClassName="space-y-2.5"
    >
      {targets.map((t) => (
        <div
          key={t.key}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-control border border-border p-3"
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
        title={`Semester targets · ${SHORT_CLASS[t.key] ?? t.label}`}
        description={
          simulator
            ? "The SGPA each remaining semester needs for the class picked above. A semester counts in proportion to its GPA credits: plan one higher and the others need less."
            : "The SGPA each remaining semester needs for the class picked above. A semester counts in proportion to its GPA credits. To plan one semester higher than another, use the What-If Simulator."
        }
        bodyClassName="space-y-3"
      >
        <p className="text-sm text-muted-foreground">
          {t.label} needs a final CGPA of {t.threshold.toFixed(2)} over your{" "}
          {t.finalCredits} GPA credits. The Dean's List needs an SGPA of{" "}
          {DEANS_LIST_SGPA.toFixed(2)} in a semester, with every course passed.
        </p>

        <ul className="space-y-2">
          {open.map((s) => {
            const sem = standing.semesterGpas.find((g) => g.semester === s.semester);
            const weight = totalOpen > 0 ? Math.round((s.openCredits / totalOpen) * 100) : 0;
            const allGuessed = s.openCredits === 0;
            return (
              <li
                key={s.semester}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-control border border-border p-3"
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
                  {(() => {
                    // The target in grades: what an SGPA looks like on a results sheet.
                    const sgpa = s.planned ?? (t.feasible && !t.alreadySecured ? t.required : null);
                    const mix = !allGuessed && sgpa !== null ? gradeMix(Math.max(0, sgpa), s.openCredits, GPV) : null;
                    return mix ? <p className="mt-0.5 text-xs font-medium text-foreground">{mix}</p> : null;
                  })()}
                </div>

                <div className="flex items-center gap-3">
                  {!allGuessed &&
                    (s.planned ?? (t.feasible && !t.alreadySecured ? t.required : 0)) >= DEANS_LIST_SGPA && (
                      <StatusBadge tone="success">Also Dean's List</StatusBadge>
                    )}
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
          <p className="rounded-control bg-primary/5 p-3 text-sm text-foreground ring-1 ring-inset ring-primary/20">
            With these plans you finish on a CGPA of{" "}
            <strong className="tabular-nums">{t.plannedFinalCgpa.toFixed(2)}</strong>:{" "}
            {classificationForGpa(t.plannedFinalCgpa)}.
          </p>
        )}

        {renderWorking(t)}

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

  /* The CGPA after each semester, on the record and then projected for the
     class picked in Semester targets. Toward it when it is within reach; at
     the student's current average when it is already secured; at the best
     possible (4.00) when it is out of reach. A planned semester takes its
     plan. */
  const renderPath = () => {
    const t = selectedClass;
    if (!t || !plan) return null;
    const anyPlanned = open.some((s) => s.planned !== null && s.openCredits > 0);
    const sgpaFor = (s: OpenSemester) =>
      s.planned ??
      (t.alreadySecured ? standing.cgpa : !t.feasible ? 4 : Math.max(0, t.required));
    const assumption = t.alreadySecured
      ? `holding your current average of ${standing.cgpa.toFixed(2)}`
      : !t.feasible
        ? "an A+ in every remaining course, the best still possible"
        : `the SGPA ${t.label} needs`;
    return (
      <CgpaPathChart
        data={cgpaPath(standing, open, sgpaFor, plan.totalSemesters)}
        target={{ label: SHORT_CLASS[t.key] ?? t.label, threshold: t.threshold }}
        assumption={anyPlanned ? `${assumption}, and your plans` : assumption}
      />
    );
  };

  /* Which scenario is open, and the few things to do with it. Saving is
     automatic, so the bar only says that it happened. */
  const renderScenarioBar = () => {
    const active = scenarios.find((x) => x.id === activeId) ?? null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Scenario</span>
        {scenarios.length > 0 ? (
          <Select value={activeId ?? undefined} onValueChange={openScenario}>
            <SelectTrigger className="h-8 w-44" aria-label="Open a scenario">
              {/* The name alone: the note beside it says when it is shared. */}
              <SelectValue placeholder="Pick a scenario">{active?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {scenarios.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.name}
                  {x.sharedWithMentor && <span className="text-muted-foreground"> · shared</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">Saved to your account as you go</span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNameDialog({ mode: "new", value: scenarios.length === 0 ? "My plan" : "" })}
          disabled={scenarios.length >= 10}
          title={scenarios.length >= 10 ? "You can keep up to 10 scenarios" : "Save what is on screen as a new scenario"}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          New
        </Button>
        {active && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="More for this scenario">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setNameDialog({ mode: "rename", value: active.name })}>
                Rename
              </DropdownMenuItem>
              {mentorName && (
                <DropdownMenuItem onSelect={() => void toggleShare(active)}>
                  {active.sharedWithMentor ? "Stop sharing with your mentor" : "Share with your mentor"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-danger-fg" onSelect={() => setConfirmDelete(true)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {mentorName && active?.sharedWithMentor && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Shared with {mentorName}
          </span>
        )}
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
        {scenarioError && <span className="text-xs text-danger-fg">{scenarioError}</span>}
        {hasSimulation && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={resetSimulation}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset to actual results
          </Button>
        )}
      </div>
    );
  };

  /* Two or more scenarios side by side: this semester's SGPA, the CGPA with
     the scenario's grades, and where it finishes when every semester ahead
     has a plan. One line each; picking one opens it. */
  const renderCompare = () => {
    if (scenarios.length < 2 || !plan || !selectedClass) return null;
    const now = sittingSemesters[0] ?? null;
    const rows = scenarios.map((sc) => {
      const c = sanitize(sc, plan, results);
      const st = computeStanding(results, GPV, c.past, sitting, c.guesses);
      const op = openSemesters(
        plan,
        st,
        Object.fromEntries(Object.entries(c.plans).map(([k, v]) => [Number(k), Number(v)])),
      );
      const fin = classTargets(st, op, [selectedClass])[0]?.plannedFinalCgpa ?? null;
      const semGpa = now !== null ? st.semesterGpas.find((g) => g.semester === now)?.sgpa ?? null : null;
      return { sc, cgpa: st.cgpa, semGpa, fin };
    });
    return (
      <SectionCard
        title="Compare scenarios"
        description="A final CGPA shows once every semester ahead has a planned SGPA."
        collapsible
        defaultOpen={false}
        storageKey="planner-compare"
        summary={`${scenarios.length} scenarios`}
        bodyClassName="space-y-2"
      >
        {rows.map(({ sc, cgpa, semGpa, fin }) => (
          <button
            key={sc.id}
            type="button"
            onClick={() => openScenario(sc.id)}
            className={cn(
              "flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-control border p-3 text-left transition-colors",
              sc.id === activeId ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40",
            )}
            aria-current={sc.id === activeId ? "true" : undefined}
          >
            <span className="font-medium text-foreground">{sc.name}</span>
            <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground tabular-nums">
              {now !== null && (
                <span>
                  Sem {now} SGPA <strong className="text-foreground">{semGpa !== null ? semGpa.toFixed(2) : "—"}</strong>
                </span>
              )}
              <span>
                CGPA <strong className="text-foreground">{cgpa.toFixed(2)}</strong>
              </span>
              <span>
                Final <strong className="text-foreground">{fin !== null ? fin.toFixed(2) : "—"}</strong>
              </span>
            </span>
          </button>
        ))}
      </SectionCard>
    );
  };

  /* The sum behind a class target, in the student's own numbers, folded
     away until asked for. */
  const renderWorking = (t: ClassTarget) => {
    const w = targetWorking(standing, open, t.threshold);
    const f2 = (n: number) => n.toFixed(2);
    const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
    const heaviest = [...w.semesters].filter((x) => !x.planned).sort((a, b) => b.credits - a.credits)[0];
    const lightest = [...w.semesters].filter((x) => !x.planned).sort((a, b) => a.credits - b.credits)[0];
    return (
      <details className="group rounded-control border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none font-medium text-primary marker:text-muted-foreground">
          How is this worked out?
        </summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>
            Your CGPA is the sum of credits × grade point, divided by your credits.{" "}
            {t.label} needs {f2(t.threshold)} × {w.finalCredits} credits ={" "}
            <strong className="text-foreground tabular-nums">{f1(w.pointsNeeded)}</strong> grade points.
          </li>
          <li>
            You have {f1(w.pointsSoFar)} from {w.creditsSoFar} credits
            {w.plannedPoints > 0 && <>, and your plans add {f1(w.plannedPoints)}</>}, so{" "}
            <strong className="text-foreground tabular-nums">{f1(Math.max(0, w.pointsLeft))}</strong> are
            still needed
            {w.freeCredits > 0 ? (
              <>
                {" "}over {w.freeCredits} credits: {f1(Math.max(0, w.pointsLeft))} ÷ {w.freeCredits} ={" "}
                <strong className="text-foreground tabular-nums">{f2(Math.max(0, w.required))}</strong>.
              </>
            ) : (
              "."
            )}
            {w.pointsLeft <= 0 && " That is nothing more, so the class is already secured."}
            {w.freeCredits > 0 && w.required > 4 && " That is more than 4.00, so it cannot be reached."}
          </li>
          {w.freeCredits > 0 && w.pointsLeft > 0 && w.required <= 4 && (
            <li>
              The same SGPA in each semester supplies exactly that:{" "}
              {w.semesters
                .map((x) => `Semester ${x.semester}, ${x.credits} × ${f2(x.sgpa)} ≈ ${Math.round(x.points)} points`)
                .join("; ")}
              .
              {heaviest && lightest && heaviest.credits !== lightest.credits && (
                <>
                  {" "}Semester {heaviest.semester} has more credits, so doing better there lowers what Semester{" "}
                  {lightest.semester} needs more than the other way round.
                </>
              )}
            </li>
          )}
        </ol>
      </details>
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
      const what = OUTSTANDING_LABEL[c.previous.grade ?? ""] ?? `Your ${c.previous.grade}`;
      return `Semester ${c.semester} · ${what}${cap ? ` · best grade ${cap}` : ""}`;
    }
    return null;
  };

  const renderSittingCard = () =>
    sittingGroups.length > 0 && (
      <SectionCard
        title="Expected grades"
        description="Pick the grade you expect in each; a course left at “—” is not counted. The ± figure is how far one full grade (A to B) in a course moves your CGPA. Your guesses are saved to your account, in the open scenario."
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
                    : "Modules to clear"}
                </h4>
                {group.semester !== null && (
                  <StatusBadge tone={guessed.length > 0 ? "brand" : "neutral"}>
                    {guessed.length > 0 && sem
                      ? `Projected SGPA: ${sem.sgpa.toFixed(2)}`
                      : "Pick grades to see your SGPA"}
                  </StatusBadge>
                )}
                {group.semester !== null &&
                  sem &&
                  guessed.length === gradable.length &&
                  gradable.length > 0 &&
                  sem.sgpa >= DEANS_LIST_SGPA &&
                  !guessed.some((c) => guessedGrades[c.courseId] === "F") && (
                    <StatusBadge tone="success">Dean's List</StatusBadge>
                  )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {guessed.length} of {gradable.length} guessed
                </span>
              </div>
              <div className="space-y-2">
                {(group.semester === null && !showAllToClear
                  ? group.courses.slice(0, 5)
                  : group.courses
                ).map((c) => {
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
                        <div className="flex flex-shrink-0 items-center gap-2">
                        <span
                          className="text-xs tabular-nums text-muted-foreground"
                          title={`One full grade in ${c.code} (for example A to B) moves your CGPA by this much`}
                        >
                          ±{gradeImpact(c, actualStanding, sitting).toFixed(2)}
                        </span>
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
                        </div>
                      ) : (
                        <span className="flex-shrink-0 text-xs text-muted-foreground">No grade yet</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {group.semester === null && group.courses.length > 5 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1"
                  onClick={() => setShowAllToClear((v) => !v)}
                >
                  {showAllToClear ? "Show fewer" : `Show all ${group.courses.length}`}
                </Button>
              )}
            </div>
          );
        })}
      </SectionCard>
    );

  /* What the degree asks for besides a GPA (Handbook p. 25): pass grades for
     144 credits, Industrial Training, and every failed, referred or deferred
     module cleared. One line each, so it reads as a checklist. The gold
     medal joins it only for a student whose best possible CGPA reaches it. */
  const renderRequirements = () => {
    if (!plan) return null;
    const r = plan.requirements;
    const gold = classTargets(standing, open, [
      { key: "gold", label: "Gold medal", threshold: GOLD_MEDAL_OGPA },
    ])[0];
    const passedPct = Math.min(100, Math.round((r.creditsPassed / r.creditsRequired) * 100));
    const firstFew = toClear
      .slice(0, 3)
      .map((c) => `${c.code} (${c.previous?.grade})`)
      .join(", ");
    const items: {
      key: string;
      state: "done" | "todo" | "attention";
      label: string;
      value: string;
      detail?: string;
      bar?: number;
      action?: React.ReactNode;
      icon?: typeof Medal;
    }[] = [
      {
        key: "credits",
        state: r.creditsPassed >= r.creditsRequired ? "done" : "todo",
        label: "Credits passed",
        value: `${r.creditsPassed} of ${r.creditsRequired}`,
        bar: passedPct,
      },
      {
        key: "clear",
        state: toClear.length === 0 ? "done" : "attention",
        label: "Modules to clear",
        value: toClear.length === 0 ? "None" : `${toClear.length} module${toClear.length === 1 ? "" : "s"}`,
        detail:
          toClear.length > 0
            ? `${firstFew}${toClear.length > 3 ? ` +${toClear.length - 3} more` : ""}`
            : undefined,
        action:
          gpaToClear.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setActiveTab("simulator")}>
              Plan
            </Button>
          ) : undefined,
      },
      {
        key: "training",
        state: r.trainingDone ? "done" : "todo",
        label: "Industrial Training",
        value: r.trainingDone ? "Completed" : "Not recorded yet",
      },
      ...(r.minor
        ? [
            {
              key: "minor",
              state: (r.minor.complete ? "done" : "todo") as "done" | "todo",
              label: `Minor: ${r.minor.name}`,
              value: `${r.minor.earned} of ${r.minor.required} credits`,
              detail: r.minor.planned > 0 ? `${r.minor.planned} in progress` : undefined,
            },
          ]
        : []),
      ...(best >= GOLD_MEDAL_OGPA
        ? [
            {
              key: "gold",
              icon: Medal,
              // Secured is the OGPA alone: four years and no disciplinary
              // action are not PES's to know.
              state: (r.repeated.length === 0 && gold.alreadySecured ? "done" : "todo") as "done" | "todo",
              label: "Gold medal",
              value:
                r.repeated.length > 0
                  ? "Not eligible"
                  : gold.alreadySecured
                    ? `OGPA ${GOLD_MEDAL_OGPA.toFixed(2)} secured`
                    : `Average ${Math.max(0, gold.required).toFixed(2)} needed`,
              detail:
                r.repeated.length > 2
                  ? `${r.repeated.slice(0, 2).join(", ")} and ${r.repeated.length - 2} more repeated`
                  : r.repeated.length > 0
                    ? `${andList(r.repeated)} repeated`
                    : `OGPA ${GOLD_MEDAL_OGPA.toFixed(2)} in four years, no repeats`,
            },
          ]
        : []),
    ];

    return (
      <SectionCard
        title="Graduation requirements"
        className="h-full"
        bodyClassName="grid gap-2 sm:grid-cols-2 lg:grid-cols-1"
      >
        {items.map((it) => {
          const Icon =
            it.icon ?? (it.state === "done" ? CheckCircle2 : it.state === "attention" ? AlertTriangle : Circle);
          return (
            <div key={it.key} className="flex items-start gap-2.5 rounded-control border border-border p-3">
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 h-4 w-4 flex-shrink-0",
                  it.state === "done"
                    ? "text-success-fg"
                    : it.state === "attention"
                      ? "text-warning-fg"
                      : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{it.label}</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{it.value}</p>
                {it.bar !== undefined && (
                  <AnimatedBar value={it.bar} max={100} label={`${it.label}: ${it.value}`} className="mt-1.5 h-1.5" />
                )}
                {it.detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{it.detail}</p>}
              </div>
              {it.action}
            </div>
          );
        })}
      </SectionCard>
    );
  };

  const finished =
    !loading && plan !== null && openCredits === 0 && sitting.length === 0 && toClear.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Graduation Planner"
        description="See what SGPA you need in each remaining semester, or try grades for this semester and see what they would change."
      />

      {loading ? (
        <div className="space-y-4">
          <SkeletonHero />
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
            {renderHero()}
            {renderSemesterTargets()}
            {/* The checklist beside the path: what the degree asks for
                besides a GPA, and where the GPA is heading. */}
            <div className="grid gap-5 lg:grid-cols-5 lg:items-stretch">
              <div className="lg:col-span-2">{renderRequirements()}</div>
              <div className="lg:col-span-3">{renderPath()}</div>
            </div>
            {renderProjectionsCard()}
          </TabsContent>

          <TabsContent value="simulator" className="mt-5 space-y-5">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2.5 rounded-card border border-primary/20 bg-primary/5 p-3"
            >
              <FlaskConical className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                {sittingSemesters.length > 0
                  ? "Put in the grades you expect this semester, plan an SGPA for a semester ahead, or change a past grade."
                  : "Plan an SGPA for a semester ahead, or change a past grade."}{" "}
                These are projections only —{" "}
                <strong>nothing here changes your real academic record.</strong>
              </p>
            </motion.div>
            {/* The open scenario stays in reach while the grades below it
                scroll past. */}
            <div className="sticky top-14 z-20 rounded-control border border-border bg-card/95 px-3 py-2 shadow-elevation-sm backdrop-blur">
              {renderScenarioBar()}
            </div>
            {renderCompare()}

            {renderHero()}
            {renderSittingCard()}
            {renderSemesterTargets()}
            {renderPath()}
            {renderProjectionsCard()}

            <SectionCard
              title="Edit past module grades"
              description="Pick a different grade for any course to see what it would change. Open a semester to edit it."
              bodyClassName="space-y-2"
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
                const edits = group.courses.filter(
                  (c) => simulatedGrades[c.resultRowId] && simulatedGrades[c.resultRowId] !== c.grade,
                ).length;
                // Closed until opened, except a semester with a changed grade,
                // which opens so the change is never hidden.
                const isOpen = pastOpen[group.semester] ?? edits > 0;
                const bodyId = `planner-past-${group.semester}`;
                return (
                  <div key={group.semester} className="rounded-control border border-border">
                    <button
                      type="button"
                      onClick={() => setPastOpen((prev) => ({ ...prev, [group.semester]: !isOpen }))}
                      aria-expanded={isOpen}
                      aria-controls={bodyId}
                      className="flex w-full flex-wrap items-center gap-2 rounded-control px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200",
                          !isOpen && "-rotate-90",
                        )}
                        aria-hidden="true"
                      />
                      <h4 className="font-semibold text-foreground">Semester {group.semester}</h4>
                      <StatusBadge tone={changed ? "brand" : "neutral"}>
                        SGPA: {semStanding?.sgpa.toFixed(2) ?? "0.00"}
                        {changed && ` (was ${actualSemStanding!.sgpa.toFixed(2)})`}
                      </StatusBadge>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {edits > 0
                          ? `${edits} grade${edits === 1 ? "" : "s"} changed`
                          : `${group.courses.length} course${group.courses.length === 1 ? "" : "s"}`}
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                    {isOpen && (
                    <motion.div
                      id={bodyId}
                      key="body"
                      variants={expand}
                      initial="collapsed"
                      animate="open"
                      exit="collapsed"
                      className="overflow-hidden"
                    >
                    <div className="space-y-2 px-3 pb-3">
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
                    </motion.div>
                    )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={nameDialog !== null} onOpenChange={(o) => !o && setNameDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{nameDialog?.mode === "rename" ? "Rename scenario" : "New scenario"}</DialogTitle>
            <DialogDescription>
              {nameDialog?.mode === "rename"
                ? "Give this scenario a new name."
                : "Saves the grades and plans on screen under a name, such as Realistic or Best case."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitName();
            }}
          >
            <Input
              autoFocus
              maxLength={40}
              value={nameDialog?.value ?? ""}
              onChange={(e) => setNameDialog((d) => (d ? { ...d, value: e.target.value } : d))}
              aria-label="Scenario name"
              placeholder="Realistic"
            />
            {scenarioError && <p className="mt-2 text-sm text-danger-fg">{scenarioError}</p>}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setNameDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!nameDialog?.value.trim()}>
                {nameDialog?.mode === "rename" ? "Rename" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {scenarios.find((x) => x.id === activeId)?.name ?? "this scenario"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its guesses and plans are removed from your account. Your academic record is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeScenario()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
