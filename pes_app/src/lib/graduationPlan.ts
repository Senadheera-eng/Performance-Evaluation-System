/**
 * The arithmetic behind the Graduation Planner, kept apart from the page so
 * every number on it comes from one place.
 *
 * The CGPA is credit-weighted: sum(credits x grade point) / sum(credits) over
 * every course that counts towards the GPA (Faculty Handbook, "Grade Point
 * Average"). Everything below follows from that one formula:
 *  - a guessed grade is one more result, weighted by the credits its result
 *    will carry (all of a two-semester course's credits, in the semester the
 *    grade is awarded);
 *  - a guessed grade for a course being repeated replaces the attempt on the
 *    record rather than adding to it, as the record itself does;
 *  - what a class needs from the semesters still to come is the grade points
 *    it takes over the degree's final GPA credits, less those already earned,
 *    spread over the credits still open.
 */

/** One published result that carries a grade point. */
export interface PlanResult {
  resultRowId: string;
  courseId: string;
  code: string;
  title: string;
  semester: number;
  /** The weight of the result: for a two-semester course, both parts. */
  credits: number;
  contributesToGpa: boolean;
  grade: string | null;
  gpv: number | null;
}

/** A course being sat now, with no result yet. */
export interface SittingCourse {
  courseId: string;
  code: string;
  title: string;
  semester: number;
  /** As the catalogue lists this part of the course. */
  credits: number;
  /** What its grade will carry: 0 for an earlier part graded later. */
  resultCredits: number;
  contributesToGpa: boolean;
  /** The attempt this one will replace, when the course is a repeat. */
  previous: { grade: string | null; gpv: number; originalGrade: string | null } | null;
  /** An earlier part: where, and for how many credits, it is graded. */
  gradedIn: { code: string; semester: number; credits: number } | null;
  /** A final part: the earlier parts its grade also covers. */
  earlierParts: { semester: number; credits: number }[];
}

export interface PlanSemester {
  semester: number;
  /** GPA credits the semester will carry. */
  credits: number;
  /** enrolled: from what the student is sitting; curriculum: from the
   *  handbook's baskets; estimate: neither could say. */
  source: "enrolled" | "curriculum" | "estimate";
}

export interface GraduationPlan {
  totalSemesters: number;
  resitMaxGrade: string;
  semesters: PlanSemester[];
  courses: SittingCourse[];
  /** Courses whose latest grade is F, R or L, not being sat now. Each must
   *  be passed to graduate; its grade will replace the one on the record. */
  outstanding: SittingCourse[];
  requirements: {
    /** Credits passed towards the degree, GPA or not, Industrial Training aside. */
    creditsPassed: number;
    creditsRequired: number;
    trainingDone: boolean;
    minor: { name: string; earned: number; planned: number; required: number; complete: boolean } | null;
  };
}

/** What an F, R or L means for the student, in a word. */
export const OUTSTANDING_LABEL: Record<string, string> = {
  F: "Failed",
  R: "Referred",
  L: "Deferred",
};

export type GpvScale = Record<string, number>;

/** Grades from best to worst: A+ before A before A-, as the handbook lists them. */
export function orderedGrades(scale: GpvScale): string[] {
  const rank = (g: string) => (g.endsWith("+") ? 0 : g.endsWith("-") ? 2 : 1);
  return Object.keys(scale).sort(
    (a, b) => scale[b] - scale[a] || a[0].localeCompare(b[0]) || rank(a) - rank(b),
  );
}

/** Grades a student can expect: every passing grade, and F. Not R or L,
 *  which are a referral and a deferral rather than results. */
export function expectableGrades(scale: GpvScale): string[] {
  return orderedGrades(scale).filter((g) => scale[g] > 0 || g === "F");
}

/** A course repeated after an F, or re-sat after an R, is capped (Handbook:
 *  "cannot secure a grade greater than 'C'"). */
export function gradeCap(course: SittingCourse, resitMaxGrade: string): string | null {
  const p = course.previous;
  if (!p) return null;
  const capped = [p.grade, p.originalGrade].some((g) => g === "F" || g === "R");
  return capped ? resitMaxGrade : null;
}

export function capGrades(grades: string[], cap: string | null, scale: GpvScale): string[] {
  if (!cap || scale[cap] === undefined) return grades;
  return grades.filter((g) => g === "F" || scale[g] <= scale[cap]);
}

export function parsePlan(raw: any): GraduationPlan {
  return {
    totalSemesters: raw?.total_semesters ?? 8,
    resitMaxGrade: raw?.resit_max_grade ?? "C",
    semesters: (raw?.semesters ?? []).map((s: any) => ({
      semester: s.semester,
      credits: s.credits ?? 0,
      source: s.source,
    })),
    courses: (raw?.courses ?? []).map((c: any) => ({
      courseId: c.course_id,
      code: c.course_code,
      title: c.title,
      semester: c.semester,
      credits: c.credits,
      resultCredits: c.result_credits ?? c.credits,
      contributesToGpa: !!c.contributes_to_gpa,
      previous: c.previous
        ? { grade: c.previous.grade, gpv: Number(c.previous.gpv), originalGrade: c.previous.original_grade ?? null }
        : null,
      gradedIn: c.graded_in
        ? { code: c.graded_in.course_code, semester: c.graded_in.semester, credits: c.graded_in.credits }
        : null,
      earlierParts: c.earlier_parts ?? [],
    })),
    outstanding: (raw?.outstanding ?? []).map((o: any) => ({
      courseId: o.course_id,
      code: o.course_code,
      title: o.title,
      semester: o.semester,
      credits: o.credits,
      resultCredits: o.result_credits ?? o.credits,
      contributesToGpa: !!o.contributes_to_gpa,
      previous: { grade: o.grade, gpv: Number(o.gpv ?? 0), originalGrade: o.original_grade ?? null },
      gradedIn: null,
      earlierParts: [],
    })),
    requirements: {
      creditsPassed: raw?.requirements?.credits_passed ?? 0,
      creditsRequired: raw?.requirements?.credits_required ?? 144,
      trainingDone: !!raw?.requirements?.training_done,
      minor: raw?.requirements?.minor
        ? {
            name: raw.requirements.minor.minor,
            earned: raw.requirements.minor.earned ?? 0,
            planned: raw.requirements.minor.planned ?? 0,
            required: raw.requirements.minor.required ?? 20,
            complete: !!raw.requirements.minor.complete,
          }
        : null,
    },
  };
}

/** A sitting course whose grade will move the GPA this semester. */
export const isGradedNow = (c: SittingCourse) =>
  c.contributesToGpa && c.resultCredits > 0 && !c.gradedIn;

export interface Standing {
  /** Grade points and credits on the record, with any edits and guesses. */
  points: number;
  credits: number;
  cgpa: number;
  semesterGpas: { semester: number; sgpa: number; credits: number }[];
  /** Guessed courses that add credits (repeats replace instead). */
  guessedNewCredits: number;
  guessedNewCreditsBySemester: Record<number, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeStanding(
  results: PlanResult[],
  scale: GpvScale,
  overrides: Record<string, string> = {},
  sitting: SittingCourse[] = [],
  guesses: Record<string, string> = {},
): Standing {
  /* Each result's contribution, so a repeat's guess can take its place. A
     grade the student is trying out is worth what the scale says; one already
     awarded is worth what was recorded with it. */
  const rows = results
    .filter((r) => r.contributesToGpa)
    .map((r) => {
      const o = overrides[r.resultRowId];
      const gpv = o ? (scale[o] ?? 0) : (r.gpv ?? (r.grade ? (scale[r.grade] ?? 0) : 0));
      return { courseId: r.courseId, semester: r.semester, credits: r.credits, gpv };
    });

  let guessedNewCredits = 0;
  const guessedNewCreditsBySemester: Record<number, number> = {};
  for (const c of sitting) {
    const g = guesses[c.courseId];
    if (!g || !isGradedNow(c)) continue;
    const gpv = scale[g] ?? 0;
    // The attempt on the record for this course, if it is a repeat.
    const standingIdx = c.previous ? rows.findIndex((r) => r.courseId === c.courseId) : -1;
    if (standingIdx >= 0) {
      rows[standingIdx] = { ...rows[standingIdx], gpv };
    } else {
      rows.push({ courseId: c.courseId, semester: c.semester, credits: c.resultCredits, gpv });
      guessedNewCredits += c.resultCredits;
      guessedNewCreditsBySemester[c.semester] =
        (guessedNewCreditsBySemester[c.semester] ?? 0) + c.resultCredits;
    }
  }

  let points = 0;
  let credits = 0;
  const bySem: Record<number, { points: number; credits: number }> = {};
  for (const r of rows) {
    points += r.gpv * r.credits;
    credits += r.credits;
    const s = (bySem[r.semester] ??= { points: 0, credits: 0 });
    s.points += r.gpv * r.credits;
    s.credits += r.credits;
  }

  return {
    points,
    credits,
    cgpa: credits > 0 ? round2(points / credits) : 0,
    semesterGpas: Object.entries(bySem)
      .map(([sem, v]) => ({
        semester: Number(sem),
        sgpa: v.credits > 0 ? round2(v.points / v.credits) : 0,
        credits: v.credits,
      }))
      .sort((a, b) => a.semester - b.semester),
    guessedNewCredits,
    guessedNewCreditsBySemester,
  };
}

/** A remaining semester as the targets see it. */
export interface OpenSemester {
  semester: number;
  source: PlanSemester["source"];
  /** All the GPA credits the semester carries. */
  credits: number;
  /** Already given a guess. */
  guessedCredits: number;
  /** Still to be decided: credits minus guessed. */
  openCredits: number;
  /** The SGPA the student has chosen to plan for these open credits. */
  planned: number | null;
}

export function openSemesters(
  plan: GraduationPlan,
  standing: Standing,
  planned: Record<number, number> = {},
): OpenSemester[] {
  return plan.semesters.map((s) => {
    const guessedCredits = Math.min(s.credits, standing.guessedNewCreditsBySemester[s.semester] ?? 0);
    const openCredits = s.credits - guessedCredits;
    const p = planned[s.semester];
    return {
      semester: s.semester,
      source: s.source,
      credits: s.credits,
      guessedCredits,
      openCredits,
      planned: openCredits > 0 && p !== undefined && Number.isFinite(p) ? p : null,
    };
  });
}

export interface ClassTarget {
  key: string;
  label: string;
  threshold: number;
  /** The SGPA every unplanned open credit needs, unclamped. */
  required: number;
  alreadySecured: boolean;
  feasible: boolean;
  /** Credits that still decide it (open and not planned). */
  freeCredits: number;
  /** GPA credits the degree will carry in all. */
  finalCredits: number;
  /** When every open credit is planned: the CGPA the plan lands on. */
  plannedFinalCgpa: number | null;
}

/**
 * What each class needs. The final CGPA is over every GPA credit of the
 * degree: those already counted (with guesses) and those still open. Planned
 * semesters are taken at their planned SGPA; the rest share what is left at
 * one SGPA, which is the credit-weighted answer: a semester with more credits
 * moves the CGPA more, but the same SGPA everywhere lands exactly on target.
 */
export function classTargets(
  standing: Standing,
  open: OpenSemester[],
  classes: { key: string; label: string; threshold: number }[],
): ClassTarget[] {
  const openCredits = open.reduce((n, s) => n + s.openCredits, 0);
  const finalCredits = standing.credits + openCredits;
  const plannedCredits = open.reduce((n, s) => n + (s.planned !== null ? s.openCredits : 0), 0);
  const plannedPoints = open.reduce((n, s) => n + (s.planned !== null ? s.planned * s.openCredits : 0), 0);
  const freeCredits = openCredits - plannedCredits;
  const plannedFinalCgpa =
    freeCredits === 0 && finalCredits > 0
      ? round2((standing.points + plannedPoints) / finalCredits)
      : null;

  return classes.map((c) => {
    const needed = c.threshold * finalCredits - standing.points - plannedPoints;
    const required = freeCredits > 0 ? needed / freeCredits : needed > 0 ? Infinity : 0;
    return {
      ...c,
      required,
      alreadySecured: needed <= 0,
      feasible: required <= 4.0,
      freeCredits,
      finalCredits,
      plannedFinalCgpa,
    };
  });
}

/** The best CGPA still possible: an A+ in every open credit. */
export function bestPossibleCgpa(standing: Standing, open: OpenSemester[]): number {
  const openCredits = open.reduce((n, s) => n + s.openCredits, 0);
  const final = standing.credits + openCredits;
  return final > 0 ? round2((standing.points + 4 * openCredits) / final) : standing.cgpa;
}

/** "A student who achieves an SGPA of 3.80 or higher, after successfully
 *  completing all Courses prescribed ... will be recommended ... to be
 *  included in the Dean's List" (Handbook p. 25). */
export const DEANS_LIST_SGPA = 3.8;

/**
 * How much one full grade (a grade point, A to B) in a course moves the
 * CGPA at the end of this semester: its credits over the GPA credits the
 * record will then carry. A 5-credit project moves it five times as far as
 * a 1-credit course, which is the point of showing it.
 */
export function gradeImpact(course: SittingCourse, standing: Standing, sitting: SittingCourse[]): number {
  const newCredits = sitting
    .filter((c) => isGradedNow(c) && !c.previous)
    .reduce((n, c) => n + c.resultCredits, 0);
  // Guessed courses are already in standing.credits; count each new course once.
  const base = standing.credits - standing.guessedNewCredits + newCredits;
  return base > 0 ? course.resultCredits / base : 0;
}

/** The numbers behind a class target, for the "How is this worked out?" note. */
export interface TargetWorking {
  finalCredits: number;
  pointsNeeded: number;
  pointsSoFar: number;
  creditsSoFar: number;
  plannedPoints: number;
  pointsLeft: number;
  freeCredits: number;
  required: number;
  /** Each open semester and the points its share of the target supplies. */
  semesters: { semester: number; credits: number; sgpa: number; points: number; planned: boolean }[];
}

export function targetWorking(standing: Standing, open: OpenSemester[], threshold: number): TargetWorking {
  const openCredits = open.reduce((n, s) => n + s.openCredits, 0);
  const finalCredits = standing.credits + openCredits;
  const pointsNeeded = threshold * finalCredits;
  const plannedPoints = open.reduce((n, s) => n + (s.planned !== null ? s.planned * s.openCredits : 0), 0);
  const freeCredits = open.reduce((n, s) => n + (s.planned === null ? s.openCredits : 0), 0);
  const pointsLeft = pointsNeeded - standing.points - plannedPoints;
  const required = freeCredits > 0 ? pointsLeft / freeCredits : 0;
  return {
    finalCredits,
    pointsNeeded,
    pointsSoFar: standing.points,
    creditsSoFar: standing.credits,
    plannedPoints,
    pointsLeft,
    freeCredits,
    required,
    semesters: open
      .filter((s) => s.openCredits > 0)
      .map((s) => {
        const sgpa = s.planned ?? Math.max(0, required);
        return { semester: s.semester, credits: s.openCredits, sgpa, points: sgpa * s.openCredits, planned: s.planned !== null };
      }),
  };
}
