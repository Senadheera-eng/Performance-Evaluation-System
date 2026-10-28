import { supabase } from "./supabase";

/**
 * A student's saved what-ifs for the Graduation Planner, kept with their
 * account so a plan made on one device is there on another. Private to the
 * student (row-level security), and never part of the academic record.
 */
export interface PlannerScenario {
  id: string;
  name: string;
  /** Course id -> expected grade. */
  guesses: Record<string, string>;
  /** Semester -> planned SGPA. */
  plans: Record<string, number>;
  /** Result id -> a past grade tried differently. */
  past: Record<string, string>;
  /** The one scenario the student's mentor can see, if any. */
  sharedWithMentor: boolean;
  updatedAt: string;
}

export type ScenarioContent = Pick<PlannerScenario, "guesses" | "plans" | "past">;

const COLUMNS = "id, name, guesses, plans, past, shared_with_mentor, updated_at";

const parse = (r: any): PlannerScenario => ({
  id: r.id,
  name: r.name,
  guesses: r.guesses ?? {},
  plans: r.plans ?? {},
  past: r.past ?? {},
  sharedWithMentor: !!r.shared_with_mentor,
  updatedAt: r.updated_at,
});

/** A message a student can act on, from a database refusal. */
function message(error: { message?: string; code?: string } | null): string {
  if (!error) return "Something went wrong.";
  if (error.code === "23505") return "You already have a scenario with that name.";
  if (/up to 10 scenarios/i.test(error.message ?? "")) return error.message!;
  if (error.code === "23514") return "Give the scenario a name of 1 to 40 characters.";
  return "The scenario could not be saved. Try again.";
}

export async function listScenarios(): Promise<{ data: PlannerScenario[]; error: string | null }> {
  const { data, error } = await supabase
    .from("planner_scenarios")
    .select(COLUMNS)
    .order("created_at");
  return { data: (data ?? []).map(parse), error: error ? message(error) : null };
}

export async function createScenario(
  name: string,
  content: ScenarioContent,
): Promise<{ data: PlannerScenario | null; error: string | null }> {
  const { data, error } = await supabase
    .from("planner_scenarios")
    .insert({ name, ...content })
    .select(COLUMNS)
    .single();
  return { data: data ? parse(data) : null, error: error ? message(error) : null };
}

export async function updateScenario(
  id: string,
  patch: Partial<ScenarioContent> & { name?: string },
): Promise<{ data: PlannerScenario | null; error: string | null }> {
  const { data, error } = await supabase
    .from("planner_scenarios")
    .update(patch)
    .eq("id", id)
    .select(COLUMNS)
    .single();
  return { data: data ? parse(data) : null, error: error ? message(error) : null };
}

export async function deleteScenario(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("planner_scenarios").delete().eq("id", id);
  return { error: error ? message(error) : null };
}

/** Let the student's mentor see this scenario (one at a time), or, with
 *  null, none. The mentor sees it read-only, with the class aimed for. */
export async function shareScenario(id: string | null): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("share_planner_scenario", { p_id: id });
  if (error) console.error("[plannerScenarios] share", error);
  return { error: error ? "Sharing did not work. Try again." : null };
}

/** The class the student last picked in Semester targets. It decides what
 *  the notice after a semester's results talks about. */
export async function getAim(): Promise<string | null> {
  const { data } = await supabase.from("planner_aims").select("class_key").maybeSingle();
  return data?.class_key ?? null;
}

export async function saveAim(studentId: string, classKey: string): Promise<void> {
  const { error } = await supabase
    .from("planner_aims")
    .upsert(
      { student_id: studentId, class_key: classKey, updated_at: new Date().toISOString() },
      { onConflict: "student_id" },
    );
  // Only a convenience: the planner works the same without it.
  if (error) console.error("[plannerScenarios] aim", error);
}
