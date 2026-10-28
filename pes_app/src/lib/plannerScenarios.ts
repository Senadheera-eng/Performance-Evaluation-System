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
  updatedAt: string;
}

export type ScenarioContent = Pick<PlannerScenario, "guesses" | "plans" | "past">;

const COLUMNS = "id, name, guesses, plans, past, updated_at";

const parse = (r: any): PlannerScenario => ({
  id: r.id,
  name: r.name,
  guesses: r.guesses ?? {},
  plans: r.plans ?? {},
  past: r.past ?? {},
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
