import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, GraduationCap } from "lucide-react";
import { Button } from "../ui/button";
import { AnimatedBar, SectionCard, SegmentedTabs, StatusBadge } from "../common";
import { MinorPlanTable } from "../minors/MinorPlanTable";
import {
  MinorDeclaration,
  MinorShortfallAlert,
} from "../minors/MinorProgress";
import {
  basketMet,
  minorShortfalls,
  minorTitle,
  planSemesters,
  statusCounts,
  type MinorPlanBasket,
  type MinorPlanCourse,
  type StudentMinorPlan,
} from "../../../lib/minorPlan";

/**
 * The minor a student is taking, on My Courses: its whole study plan from
 * Semester 5 to 8, as the department's table prints it, with what they have
 * passed and are enrolled in marked against every row.
 *
 * A student taking Data Management sees the Data Management plan, one taking
 * High Performance Computing sees that one. A student who has not chosen
 * sees every minor side by side, and can say which they are taking -- the
 * same choice the Enrollment page makes.
 */
export function MyMinor({
  plan,
  semester,
  onChanged,
}: {
  plan: StudentMinorPlan;
  /** The student's current semester. */
  semester: number;
  onChanged: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState(plan.chosen_minor ?? plan.minors[0]?.minor ?? "");
  const [comparing, setComparing] = useState(false);

  // Follow the choice when it changes, and a minor renamed or removed.
  useEffect(() => {
    setTab(plan.chosen_minor ?? plan.minors[0]?.minor ?? "");
    setComparing(false);
  }, [plan.chosen_minor, plan.minors]);

  const minor = plan.minors.find((m) => m.minor === tab) ?? plan.minors[0];

  const counts = (c: MinorPlanCourse) => statusCounts(c.status);
  const stateOf = useMemo(
    () => (b: MinorPlanBasket) => {
      const have = b.courses.reduce((n, c) => n + (counts(c) ? c.credits : 0), 0);
      return { have, met: basketMet(b, have, b.courses.every(counts)) };
    },
    [],
  );

  if (!minor) return null;

  const semesters = planSemesters(minor);
  const taking = plan.chosen_minor === minor.minor;
  const showTabs = plan.minors.length > 1 && (!plan.chosen_minor || comparing);
  const totalHave = minor.baskets.reduce((n, b) => n + stateOf(b).have, 0);
  const shortfalls =
    taking && semesters.includes(semester) ? minorShortfalls(minor, semester, (c) => counts(c)) : [];

  const note = (c: MinorPlanCourse) =>
    c.status === "passed" ? (
      <StatusBadge tone="success">Passed{c.grade ? ` · ${c.grade}` : ""}</StatusBadge>
    ) : c.status === "enrolled" ? (
      <StatusBadge tone="info">Enrolled</StatusBadge>
    ) : c.status === "failed" ? (
      <StatusBadge tone="danger">Not passed{c.grade ? ` · ${c.grade}` : ""}</StatusBadge>
    ) : null;

  return (
    <SectionCard
      title={plan.chosen_minor ? "My minor" : "Minors"}
      description={
        plan.chosen_minor
          ? "The study plan of the minor you are taking, with what you have passed and are enrolled in. Courses in red are mandatory; the rest of each semester is an elective basket with a minimum number of credits."
          : "Your department's minors, as its study plan sets them out. Say which one you are taking and this page shows only its plan, and enrolment warns you before you leave out its courses."
      }
      flush
    >
      <div className="space-y-4 p-4">
        {showTabs && (
          <SegmentedTabs
            aria-label="Minor"
            layoutId="my-minor-tabs"
            value={minor.minor}
            onChange={setTab}
            tabs={plan.minors.map((m) => ({
              value: m.minor,
              label: plan.chosen_minor === m.minor ? `${m.minor} ✓` : m.minor,
            }))}
          />
        )}

        {/* The minor and how far along it the student is: the credits that
            count against what it needs, as a bar that fills on arrival. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-control border border-primary/15 surface-tint px-4 py-3.5">
          <div className="flex min-w-0 flex-1 basis-[16rem] items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <GraduationCap className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                {minorTitle(minor.minor)}
                {minor.complete && (
                  <StatusBadge tone="success" icon={CheckCircle2}>
                    Complete
                  </StatusBadge>
                )}
              </h3>
              <AnimatedBar
                value={Math.min(totalHave, minor.required_credits)}
                max={minor.required_credits}
                tone={minor.complete || totalHave >= minor.required_credits ? "success" : "brand"}
                label={`${totalHave} of ${minor.required_credits} credits counted`}
                className="mt-2 max-w-sm"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {totalHave} of {minor.required_credits} credits counted
                {minor.earned_credits ? ` · ${minor.earned_credits} passed` : ""}
                {minor.planned_credits ? ` · ${minor.planned_credits} enrolled` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {plan.chosen_minor && plan.minors.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setComparing((v) => !v)}>
                {comparing ? "Show only my minor" : "Compare minors"}
              </Button>
            )}
            <MinorDeclaration chosenMinor={plan.chosen_minor} minor={minor.minor} onChanged={onChanged} />
          </div>
        </div>

        {shortfalls.length > 0 && (
          <div className="space-y-2">
            <MinorShortfallAlert
              minor={minor.minor}
              semester={semester}
              shortfalls={shortfalls}
              hint={
                <>
                  Enrol in {shortfalls.length === 1 ? "it" : "them"} on the{" "}
                  <Link to="/app/enrollment" className="font-semibold underline">
                    Enrollment
                  </Link>{" "}
                  page while the window is open.
                </>
              }
            />
          </div>
        )}
      </div>

      <div className="border-t border-border">
        {minor.baskets.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Your department has not set out this minor's study plan yet.
          </p>
        ) : (
          <MinorPlanTable
            plan={minor}
            caption={`${minorTitle(minor.minor)}, the whole study plan.`}
            courseNote={note}
            basketState={stateOf}
            totalHave={totalHave}
          />
        )}
      </div>
    </SectionCard>
  );
}
