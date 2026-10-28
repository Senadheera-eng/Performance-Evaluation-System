import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard, SkeletonRows, StatusBadge } from "../common";
import { useSettings } from "../../../lib/settings";
import { cn } from "../ui/utils";
import {
  capGrades,
  classTargets,
  computeStanding,
  expectableGrades,
  gradeCap,
  isGradedNow,
  openSemesters,
  parsePlan,
  type PlanResult,
} from "../../../lib/graduationPlan";
import {
  getMenteeGraduationPlan,
  type MenteeGraduationPlan,
} from "../../../lib/mentorService";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * The plan a mentee has shared from their Graduation Planner, read-only: the
 * class they are aiming for, the SGPA each semester ahead needs for it (or
 * the one they have planned), and their CGPA with the grades they expect.
 *
 * The numbers are worked out here the way the planner works them out, from
 * the same record. A past grade the student tried differently is left out:
 * a mentor is looking at the student's real record, not a what-if about it.
 */
export function MenteePlanCard({ studentId }: { studentId: string }) {
  const settings = useSettings();
  const [data, setData] = useState<MenteeGraduationPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getMenteeGraduationPlan(studentId);
    setFailed(!result.ok);
    setData(result.ok ? result.data : null);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const view = useMemo(() => {
    if (!data?.shared) return null;
    const shared = data.shared;
    const plan = parsePlan(data.plan);
    const results: PlanResult[] = data.results.map((r) => ({
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
    const sitting = [...plan.courses, ...plan.outstanding];
    // Only guesses that still fit, as the planner keeps them: a course still
    // being sat or to clear, and a grade it can get (a repeat is capped).
    const expectable = expectableGrades(settings.gpvScale);
    const guesses = Object.fromEntries(
      Object.entries(shared.guesses ?? {}).filter(([id, g]) => {
        const c = sitting.find((x) => x.courseId === id);
        return (
          c && isGradedNow(c) &&
          capGrades(expectable, gradeCap(c, plan.resitMaxGrade), settings.gpvScale).includes(g)
        );
      }),
    );
    const plans = Object.fromEntries(
      Object.entries(shared.plans ?? {}).map(([k, v]) => [Number(k), Number(v)]),
    );
    const now = computeStanding(results, settings.gpvScale);
    const standing = computeStanding(results, settings.gpvScale, {}, sitting, guesses);
    const open = openSemesters(plan, standing, plans);
    const targets = classTargets(standing, open, settings.honoursClassifications);
    const aimed = targets.find((t) => t.key === shared.aim) ?? null;
    // No aim recorded: the best class still within reach, as the planner opens on.
    const target =
      aimed ??
      targets.find((t) => !t.alreadySecured && t.feasible) ??
      targets.find((t) => t.alreadySecured) ??
      targets[0];
    return {
      shared,
      now,
      standing,
      guessCount: Object.keys(guesses).length,
      open: open.filter((s) => s.openCredits > 0),
      aimed,
      target,
    };
  }, [data, settings]);

  const classLabel = (gpa: number) =>
    settings.honoursClassifications.find((c) => gpa >= c.threshold)?.label ?? "Below Pass";

  if (loading) {
    return (
      <SectionCard title="Graduation plan">
        <SkeletonRows count={1} height="h-14" />
      </SectionCard>
    );
  }

  if (!view) {
    return (
      <SectionCard title="Graduation plan">
        <p className="text-sm text-muted-foreground">
          {failed
            ? "The plan could not be loaded."
            : "No plan shared yet. A student can share one from their Graduation Planner."}
        </p>
      </SectionCard>
    );
  }

  const { shared, now, standing, guessCount, open, aimed, target: t } = view;
  return (
    <SectionCard
      title="Graduation plan"
      description={`Shared from their Graduation Planner: “${shared.name}”, updated ${when(shared.updated_at)}.`}
      actions={aimed ? <StatusBadge tone="brand">Aiming for {aimed.label}</StatusBadge> : undefined}
      bodyClassName="space-y-3"
    >
      <div
        className={cn(
          "grid gap-2 sm:grid-cols-2",
          open.length === 1 ? "lg:grid-cols-2" : open.length === 2 ? "lg:grid-cols-3" : "lg:grid-cols-4",
        )}
      >
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">
            {guessCount > 0 ? "CGPA with expected grades" : "CGPA"}
          </p>
          <p className="text-sm font-semibold tabular-nums text-foreground">{standing.cgpa.toFixed(2)}</p>
          {guessCount > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              now {now.cgpa.toFixed(2)}, {guessCount} grade{guessCount === 1 ? "" : "s"} expected
            </p>
          )}
        </div>
        {open.map((s) => (
          <div key={s.semester} className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Semester {s.semester}</p>
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {s.planned !== null
                ? `Planned ${s.planned.toFixed(2)}`
                : t.alreadySecured
                  ? "Secured"
                  : !t.feasible
                    ? "Above 4.00"
                    : `SGPA ${Math.max(0, t.required).toFixed(2)}`}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {s.openCredits} credits
              {s.guessedCredits > 0 && ` (${s.guessedCredits} more guessed)`}
              {s.planned === null && ` · for ${t.label}`}
            </p>
          </div>
        ))}
      </div>
      {t.plannedFinalCgpa !== null && (
        <p className="text-sm text-foreground">
          Their plan finishes on a CGPA of{" "}
          <strong className="tabular-nums">{t.plannedFinalCgpa.toFixed(2)}</strong>:{" "}
          {classLabel(t.plannedFinalCgpa)}.
        </p>
      )}
    </SectionCard>
  );
}
