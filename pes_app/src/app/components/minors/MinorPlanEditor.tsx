import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { CourseCode, CourseSelect, StatusBadge } from "../common";
import { cn } from "../ui/utils";
import { supabase } from "../../../lib/supabase";
import {
  addBasket,
  addPlanCourse,
  deleteBasket,
  planSemesters,
  removePlanCourse,
  updateBasket,
  updatePlanCourse,
  type MinorPlan,
  type MinorPlanBasket,
} from "../../../lib/minorPlan";

interface CurriculumCourse {
  semester: number;
  course_id: string;
  course_code: string;
  title: string;
  credits: number;
}

type Outcome = { ok: boolean; error?: string };

/**
 * Editing a minor's study plan, a semester at a time, in the same terms the
 * department's sheet uses: baskets, each mandatory (printed in red) or
 * elective with a minimum number of credits, and the courses in them with
 * the credits the plan counts.
 *
 * A course is picked from the department's curriculum for that semester, so
 * the plan cannot name a course students could not enrol in then. Its
 * credits start at the catalogue's figure and can be changed, for a project
 * whose credits the plan splits across two semesters.
 */
export function MinorPlanEditor({
  department,
  plan,
  onChanged,
}: {
  department: string;
  plan: MinorPlan;
  onChanged: () => Promise<void> | void;
}) {
  const [curriculum, setCurriculum] = useState<CurriculumCourse[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSemester, setNewSemester] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("curriculum_slots")
        .select("semester, course_id, courses(course_code, title, credits)")
        .eq("department", department);
      if (cancelled) return;
      setCurriculum(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((data ?? []) as any[])
          .filter((r) => r.courses)
          .map((r) => ({
            semester: r.semester,
            course_id: r.course_id,
            course_code: r.courses.course_code,
            title: r.courses.title,
            credits: r.courses.credits,
          }))
          .sort((a, b) => a.course_code.localeCompare(b.course_code)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [department]);

  const run = async (action: () => Promise<Outcome>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That did not work. Please try again.");
      return;
    }
    await onChanged();
  };

  const semesters = planSemesters(plan);
  const unused = [1, 2, 3, 4, 5, 6, 7, 8].filter((s) => !semesters.includes(s));
  const minimums = plan.baskets.reduce((n, b) => n + b.min_credits, 0);

  const addTo = (semester: number, mandatory: boolean) => {
    const inSemester = plan.baskets.filter((b) => b.semester === semester);
    const position = inSemester.reduce((n, b) => Math.max(n, b.position), 0) + 1;
    return run(() =>
      addBasket({
        department,
        minor: plan.minor,
        semester,
        position,
        min_credits: mandatory ? 0 : 2,
        mandatory,
      }),
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        The baskets' minimums add up to{" "}
        <span
          className={cn(
            "font-semibold",
            minimums === plan.required_credits ? "text-success-fg" : "text-warning-fg",
          )}
        >
          {minimums}
        </span>{" "}
        of the {plan.required_credits} credits that claim the minor. A mandatory basket's
        minimum follows its courses.
      </p>
      {error && <p className="text-sm text-danger-fg">{error}</p>}

      {semesters.map((s) => (
        <section key={s} className="rounded-xl border border-border">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2">
            <h4 className="text-sm font-semibold text-foreground">Semester {s}</h4>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => addTo(s, true)}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Mandatory basket
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => addTo(s, false)}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Elective basket
              </Button>
            </div>
          </header>
          <div className="divide-y divide-border/70">
            {plan.baskets
              .filter((b) => b.semester === s)
              .sort((a, b) => a.position - b.position)
              .map((b) => (
                <BasketEditor
                  key={b.id}
                  basket={b}
                  options={curriculum.filter((c) => c.semester === s)}
                  busy={busy}
                  run={run}
                />
              ))}
          </div>
        </section>
      ))}

      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={newSemester}
            onChange={(e) => setNewSemester(e.target.value)}
            className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
            aria-label="Semester to add"
          >
            <option value="">Add a semester…</option>
            {unused.map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !newSemester}
            onClick={async () => {
              await addTo(Number(newSemester), false);
              setNewSemester("");
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

function BasketEditor({
  basket,
  options,
  busy,
  run,
}: {
  basket: MinorPlanBasket;
  options: CurriculumCourse[];
  busy: boolean;
  run: (action: () => Promise<Outcome>) => Promise<void>;
}) {
  const [min, setMin] = useState(String(basket.min_credits));
  const [credits, setCredits] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState("");

  useEffect(() => setMin(String(basket.min_credits)), [basket.min_credits]);

  const available = useMemo(
    () => options.filter((o) => !basket.courses.some((c) => c.course_id === o.course_id)),
    [options, basket.courses],
  );

  /* A mandatory basket asks for all of itself, so its minimum is kept equal
     to its courses' credits rather than typed in separately. */
  const coursesTotal = (courses = basket.courses) => courses.reduce((n, c) => n + c.credits, 0);
  const syncMandatoryMin = async (total: number) =>
    basket.mandatory && total !== basket.min_credits
      ? updateBasket(basket.id, { min_credits: total })
      : { ok: true as const, data: null };

  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={basket.mandatory}
            disabled={busy}
            onCheckedChange={(v) =>
              run(() =>
                updateBasket(basket.id, {
                  mandatory: v,
                  ...(v ? { min_credits: coursesTotal() } : {}),
                }),
              )
            }
            aria-label="Mandatory basket"
          />
          {basket.mandatory ? (
            <StatusBadge tone="danger">Mandatory</StatusBadge>
          ) : (
            <span className="text-foreground">Elective</span>
          )}
        </label>
        {!basket.mandatory && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            at least
            <Input
              type="number"
              min={0}
              value={min}
              onChange={(e) => setMin(e.target.value)}
              onBlur={() => {
                const n = Number(min);
                if (Number.isFinite(n) && n >= 0 && n !== basket.min_credits) {
                  run(() => updateBasket(basket.id, { min_credits: n }));
                }
              }}
              className="h-8 w-16"
              aria-label="Minimum credits"
            />
            credits
          </label>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive"
          disabled={busy}
          onClick={() => run(() => deleteBasket(basket.id))}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Remove basket
        </Button>
      </div>

      {basket.courses.length > 0 && (
        <ul className="space-y-1">
          {basket.courses.map((c) => (
            <li key={c.course_id} className="flex flex-wrap items-center gap-2 text-sm">
              <CourseCode code={c.course_code} className="w-16 font-semibold" />
              <span className={cn("min-w-0 flex-1", basket.mandatory ? "text-danger-fg" : "text-foreground")}>
                {c.title}
              </span>
              <Input
                type="number"
                min={1}
                value={credits[c.course_id] ?? String(c.credits)}
                onChange={(e) => setCredits((p) => ({ ...p, [c.course_id]: e.target.value }))}
                onBlur={() => {
                  const n = Number(credits[c.course_id] ?? c.credits);
                  if (Number.isFinite(n) && n > 0 && n !== c.credits) {
                    run(async () => {
                      const r = await updatePlanCourse(basket.id, c.course_id, n);
                      if (!r.ok) return r;
                      return syncMandatoryMin(coursesTotal() - c.credits + n);
                    });
                  }
                }}
                className="h-8 w-16"
                aria-label={`Credits for ${c.course_code}`}
              />
              <span className="text-xs text-muted-foreground">credits</span>
              {c.catalogue_credits !== undefined && c.catalogue_credits !== c.credits && (
                <span className="text-xs text-muted-foreground">
                  (catalogue: {c.catalogue_credits})
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await removePlanCourse(basket.id, c.course_id);
                    if (!r.ok) return r;
                    return syncMandatoryMin(coursesTotal() - c.credits);
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Remove {c.course_code}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <CourseSelect
          value={adding}
          onChange={setAdding}
          options={available.map((o) => ({
            value: o.course_id,
            code: o.course_code,
            detail: `${o.title} · ${o.credits} cr`,
          }))}
          placeholder={
            available.length > 0
              ? "Add a course from this semester's curriculum…"
              : "No more courses in this semester's curriculum"
          }
          ariaLabel="Course to add"
          className="h-9 max-w-md flex-1"
        />
        <Button
          size="sm"
          disabled={busy || !adding}
          onClick={async () => {
            const course = options.find((o) => o.course_id === adding);
            if (!course) return;
            const position = basket.courses.reduce((n, c) => Math.max(n, c.position ?? 0), 0) + 1;
            await run(async () => {
              const r = await addPlanCourse({
                basket_id: basket.id,
                course_id: course.course_id,
                credits: course.credits,
                position,
              });
              if (!r.ok) return r;
              return syncMandatoryMin(coursesTotal() + course.credits);
            });
            setAdding("");
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Add course
        </Button>
      </div>
    </div>
  );
}
