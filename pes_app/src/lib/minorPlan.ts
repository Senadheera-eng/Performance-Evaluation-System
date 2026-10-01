import { supabase } from "./supabase";

/**
 * A minor as the department's study plan prints it.
 *
 * Each minor is a set of baskets, one or more per semester from Semester 5:
 * the mandatory one (printed in red, every course in it required) and an
 * elective one (take at least `min_credits` from its courses). The credits
 * are the plan's, which for a project running over two semesters is the
 * share counted in that semester rather than the course's whole value.
 *
 * Nothing about any particular minor is written into the pages. They draw
 * whatever the department has entered, so a revised study plan is a change
 * of data, not of code.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(where: string, error: { message?: string } | null): { ok: false; error: string } {
  console.error(`[minorPlan] ${where}`, error);
  return { ok: false, error: error?.message ?? "Something went wrong. Please try again." };
}

/** Where a student stands with one course of the plan. */
export type MinorCourseStatus = "passed" | "enrolled" | "failed" | "none";

export interface MinorPlanCourse {
  course_id: string;
  course_code: string;
  title: string;
  /** As the plan counts it in this semester. */
  credits: number;
  /** The catalogue's credit value, on the department's own reading. */
  catalogue_credits?: number;
  position?: number;
  /** Only on a student's plan. */
  status?: MinorCourseStatus;
  grade?: string | null;
}

export interface MinorPlanBasket {
  id: string;
  semester: number;
  position: number;
  min_credits: number;
  /** The red basket: every course in it is required. */
  mandatory: boolean;
  courses: MinorPlanCourse[];
  /** Only on a student's plan: credits passed or enrolled. */
  counted_credits?: number;
  met?: boolean;
}

export interface MinorPlan {
  minor: string;
  required_credits: number;
  baskets: MinorPlanBasket[];
  /** Only on a student's plan. */
  earned_credits?: number;
  planned_credits?: number;
  complete?: boolean;
}

export interface StudentMinorPlan {
  /** The minor the student has said they are taking. */
  chosen_minor: string | null;
  minors: MinorPlan[];
}

/** "Minor in Data Management", as the plan titles it. */
export const minorTitle = (minor: string) => `Minor in ${minor}`;

/** The semesters a minor's plan covers, in order. */
export function planSemesters(plan: MinorPlan): number[] {
  return [...new Set(plan.baskets.map((b) => b.semester))].sort((a, b) => a - b);
}

/** Whether a course counts toward its basket: passed, or enrolled in. */
export const statusCounts = (s: MinorCourseStatus | undefined) =>
  s === "passed" || s === "enrolled";

/** A basket is met when the mandatory courses are all counted, or the
    elective credits reach the minimum. */
export function basketMet(basket: MinorPlanBasket, have: number, allCounted: boolean): boolean {
  return basket.mandatory ? basket.courses.length > 0 && allCounted : have >= basket.min_credits;
}

export async function getDepartmentMinorPlan(department: string): Promise<Result<MinorPlan[]>> {
  const { data, error } = await supabase.rpc("get_department_minor_plan", {
    p_department: department,
  });
  if (error) return fail("get_department_minor_plan", error);
  return { ok: true, data: (data ?? []) as MinorPlan[] };
}

/** The minor a student is taking; null to take none. */
export async function setMyMinor(minor: string | null): Promise<Result<null>> {
  const { error } = await supabase.rpc("set_my_minor", { p_minor: minor });
  if (error) return fail("set_my_minor", error);
  return { ok: true, data: null };
}

/* Editing the plan. Row-level security lets the department's admin, its
   sitting head and the super admin write; everyone else reads. */

export async function addBasket(input: {
  department: string;
  minor: string;
  semester: number;
  position: number;
  min_credits: number;
  mandatory: boolean;
}): Promise<Result<string>> {
  const { data, error } = await supabase
    .from("minor_plan_baskets")
    .insert(input)
    .select("id")
    .single();
  if (error) return fail("addBasket", error);
  return { ok: true, data: data.id as string };
}

export async function updateBasket(
  id: string,
  patch: Partial<{ min_credits: number; mandatory: boolean; position: number }>,
): Promise<Result<null>> {
  const { error } = await supabase.from("minor_plan_baskets").update(patch).eq("id", id);
  if (error) return fail("updateBasket", error);
  return { ok: true, data: null };
}

export async function deleteBasket(id: string): Promise<Result<null>> {
  const { error } = await supabase.from("minor_plan_baskets").delete().eq("id", id);
  if (error) return fail("deleteBasket", error);
  return { ok: true, data: null };
}

export async function addPlanCourse(input: {
  basket_id: string;
  course_id: string;
  credits: number;
  position: number;
}): Promise<Result<null>> {
  const { error } = await supabase.from("minor_plan_courses").insert(input);
  if (error) {
    return fail(
      "addPlanCourse",
      error.code === "23505" ? { message: "That course is already in this basket." } : error,
    );
  }
  return { ok: true, data: null };
}

export async function updatePlanCourse(
  basketId: string,
  courseId: string,
  credits: number,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("minor_plan_courses")
    .update({ credits })
    .eq("basket_id", basketId)
    .eq("course_id", courseId);
  if (error) return fail("updatePlanCourse", error);
  return { ok: true, data: null };
}

export async function removePlanCourse(basketId: string, courseId: string): Promise<Result<null>> {
  const { error } = await supabase
    .from("minor_plan_courses")
    .delete()
    .eq("basket_id", basketId)
    .eq("course_id", courseId);
  if (error) return fail("removePlanCourse", error);
  return { ok: true, data: null };
}

/** What a minor still asks of a student in one semester. */
export type MinorShortfall =
  | { kind: "mandatory"; basket: MinorPlanBasket; course: MinorPlanCourse }
  | { kind: "elective"; basket: MinorPlanBasket; have: number };

/**
 * The mandatory courses not taken and the elective baskets short of their
 * minimum, for one semester of a minor. `counts` says whether a course is
 * taken -- passed, enrolled, or ticked and not yet saved.
 */
export function minorShortfalls(
  plan: MinorPlan,
  semester: number,
  counts: (course: MinorPlanCourse, basket: MinorPlanBasket) => boolean,
): MinorShortfall[] {
  const out: MinorShortfall[] = [];
  plan.baskets
    .filter((b) => b.semester === semester)
    .sort((a, b) => a.position - b.position)
    .forEach((b) => {
      if (b.mandatory) {
        b.courses.filter((c) => !counts(c, b)).forEach((c) => out.push({ kind: "mandatory", basket: b, course: c }));
      } else {
        const have = b.courses.reduce((n, c) => n + (counts(c, b) ? c.credits : 0), 0);
        if (have < b.min_credits) out.push({ kind: "elective", basket: b, have });
      }
    });
  return out;
}

/** A shortfall in a sentence, e.g. "take at least 3 credits from CO4351 or CO4352 (you have 0)". */
export function describeShortfall(s: MinorShortfall): string {
  if (s.kind === "mandatory") return `${s.course.course_code} ${s.course.title} — mandatory`;
  const codes = s.basket.courses.map((c) => c.course_code);
  const list = codes.length > 1 ? `${codes.slice(0, -1).join(", ")} or ${codes[codes.length - 1]}` : codes[0];
  return `at least ${s.basket.min_credits} credit${s.basket.min_credits === 1 ? "" : "s"} from ${list} (you have ${s.have})`;
}
