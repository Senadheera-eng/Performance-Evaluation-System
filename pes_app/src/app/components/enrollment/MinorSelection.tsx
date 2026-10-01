import { useEffect, useMemo, useState } from "react";
import {
  CalendarOff,
  ChevronDown,
  GraduationCap,
  Lock,
  Minus,
  Plus,
} from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import { SectionCard, SegmentedTabs, StatusBadge } from "../common";
import { cn } from "../ui/utils";
import { MinorPlanTable, type BasketState } from "../minors/MinorPlanTable";
import {
  MinorDeclaration,
  MinorSemesterChips,
  MinorShortfallAlert,
} from "../minors/MinorProgress";
import {
  basketMet,
  minorShortfalls,
  minorTitle,
  planSemesters,
  type MinorPlan,
  type MinorPlanBasket,
  type MinorPlanCourse,
  type StudentMinorPlan,
} from "../../../lib/minorPlan";
import type { PlanCourse } from "./SemesterBaskets";

/**
 * The minor, beside the semester it is enrolled in.
 *
 * A minor runs from Semester 5 to 8, and each semester of it is a small
 * piece of the department's study plan: one course in red that the minor
 * cannot do without, and an elective basket with a minimum number of
 * credits. What a student needs at enrolment is that piece — "for this minor,
 * which courses do I take this semester?" — so that is what is shown, laid
 * out as the official table lays it out. The whole plan is one click away,
 * with how far they have got through it.
 *
 * The checkboxes here are the semester sheet's checkboxes: ticking Data
 * Mining here ticks it below, and one Save covers both. The page knows no
 * minor by name; everything comes from the plan the department entered.
 */
export function MinorSelection({
  semester,
  plan,
  coursesById,
  counts,
  chosen,
  editable,
  toggle,
  changed,
  open,
  onMinorChanged,
}: {
  semester: number;
  plan: StudentMinorPlan;
  /** This semester's courses, as the sheet below has them. */
  coursesById: Map<string, PlanCourse>;
  /** Whether a plan course counts toward its basket, unsaved ticks included. */
  counts: (course: MinorPlanCourse, basket: MinorPlanBasket) => boolean;
  chosen: (c: PlanCourse) => boolean;
  editable: (c: PlanCourse) => boolean;
  toggle: (c: PlanCourse) => void;
  changed: (courseId: string) => boolean;
  /** Whether enrolment is open, to say why a box cannot be ticked. */
  open: boolean;
  onMinorChanged: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<string>(plan.chosen_minor ?? plan.minors[0]?.minor ?? "");
  /** Null until the student chooses: open by default only before the minor starts. */
  const [showAll, setShowAll] = useState<boolean | null>(null);

  // A minor renamed or removed since the page opened.
  useEffect(() => {
    if (!plan.minors.some((m) => m.minor === tab)) {
      setTab(plan.chosen_minor ?? plan.minors[0]?.minor ?? "");
    }
  }, [plan, tab]);

  const minor: MinorPlan | undefined = plan.minors.find((m) => m.minor === tab);

  const stateOf = useMemo(
    () =>
      (b: MinorPlanBasket): BasketState => {
        const have = b.courses.reduce((n, c) => n + (counts(c, b) ? c.credits : 0), 0);
        return { have, met: basketMet(b, have, b.courses.every((c) => counts(c, b))) };
      },
    [counts],
  );

  if (!minor) return null;

  const semesters = planSemesters(minor);
  const first = semesters[0];
  const thisSemester = minor.baskets.filter((b) => b.semester === semester);
  const totalHave = minor.baskets.reduce((n, b) => n + stateOf(b).have, 0);
  const taking = plan.chosen_minor === minor.minor;
  const expanded = showAll ?? semester < first;

  /* The minor the student is taking, whichever tab is showing: what it still
     asks of them this semester is said in red at the top of the card. */
  const takingPlan = plan.minors.find((m) => m.minor === plan.chosen_minor);
  const shortfalls = open && takingPlan ? minorShortfalls(takingPlan, semester, counts) : [];

  /* What a row says beyond code, title and credits — the same words the
     semester sheet uses for the same course. */
  const note = (c: MinorPlanCourse, b: MinorPlanBasket) => {
    const pc = b.semester === semester ? coursesById.get(c.course_id) : undefined;
    if (!pc) {
      if (c.status === "passed") return <StatusBadge tone="success">Passed{c.grade ? ` · ${c.grade}` : ""}</StatusBadge>;
      if (c.status === "enrolled") return <StatusBadge tone="info">Enrolled</StatusBadge>;
      if (c.status === "failed") return <StatusBadge tone="danger">Not passed{c.grade ? ` · ${c.grade}` : ""}</StatusBadge>;
      if (b.semester === semester) {
        return (
          <StatusBadge tone="neutral" icon={CalendarOff}>
            Not in your Semester {semester} curriculum
          </StatusBadge>
        );
      }
      return null;
    }
    const want = chosen(pc);
    const isChanged = changed(pc.course_id);
    return (
      <>
        {pc.already_passed && <StatusBadge tone="success">Passed</StatusBadge>}
        {pc.selected && !pc.already_passed && !isChanged && (
          <StatusBadge tone="success">Enrolled</StatusBadge>
        )}
        {isChanged && (
          <StatusBadge tone={want ? "brand" : "warning"} icon={want ? Plus : Minus}>
            {want ? "Adding" : "Removing"}
          </StatusBadge>
        )}
        {pc.locked && (
          <StatusBadge tone="neutral" icon={Lock}>
            Marks recorded
          </StatusBadge>
        )}
        {open && !pc.enrollable && !pc.already_passed && !pc.selected && (
          <StatusBadge tone="neutral" icon={CalendarOff}>
            Not in this round
          </StatusBadge>
        )}
      </>
    );
  };

  const checkbox = (c: MinorPlanCourse, b: MinorPlanBasket) => {
    const pc = coursesById.get(c.course_id);
    const label = `${c.course_code} ${c.title}`;
    if (!pc || b.semester !== semester) {
      return (
        <Checkbox
          className="mt-0.5"
          checked={counts(c, b)}
          disabled
          aria-label={`${label}${counts(c, b) ? " — counted" : ""}`}
        />
      );
    }
    const want = chosen(pc);
    return (
      <Checkbox
        className="mt-0.5"
        checked={want}
        disabled={!editable(pc)}
        onCheckedChange={() => toggle(pc)}
        aria-label={`${want ? "Drop" : "Enrol in"} ${label}`}
      />
    );
  };

  return (
    <SectionCard
      title="Minor selection"
      description="Optional. Courses in red are mandatory for the minor; the others in a semester form an elective basket with a minimum number of credits — as in the department's study plan. Ticking a course here ticks it in your semester below."
      flush
    >
      <div className="space-y-4 p-4">
        {plan.minors.length > 1 && (
          <SegmentedTabs
            aria-label="Minor"
            layoutId="minor-selection-tabs"
            value={minor.minor}
            onChange={setTab}
            tabs={plan.minors.map((m) => ({
              value: m.minor,
              label: plan.chosen_minor === m.minor ? `${m.minor} ✓` : m.minor,
            }))}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
              <GraduationCap className="h-4 w-4 text-primary" aria-hidden="true" />
              {minorTitle(minor.minor)}
              {semester >= first && thisSemester.length > 0 && (
                <span className="font-normal text-muted-foreground">— Semester {semester}</span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {totalHave} of {minor.required_credits} credits counted
              {minor.earned_credits ? ` · ${minor.earned_credits} passed` : ""}
            </p>
          </div>
          <MinorDeclaration
            chosenMinor={plan.chosen_minor}
            minor={minor.minor}
            onChanged={onMinorChanged}
          />
        </div>
        {!taking && !plan.chosen_minor && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Say which minor you are taking and enrolment will warn you before you leave out its
            courses.
          </p>
        )}

        {takingPlan && (
          <MinorShortfallAlert
            minor={takingPlan.minor}
            semester={semester}
            shortfalls={shortfalls}
          />
        )}

        <MinorSemesterChips minor={minor} semester={semester} stateOf={stateOf} />
      </div>

      <div className="border-t border-border">
        {semester < first ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Minor selection starts in Semester {first}. The full plan is below, so you can see what
            each minor asks for before then.
          </p>
        ) : thisSemester.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            The {minorTitle(minor.minor)} has nothing in Semester {semester}.
          </p>
        ) : (
          <MinorPlanTable
            plan={minor}
            semesters={[semester]}
            showSemester={false}
            caption={`${minorTitle(minor.minor)}, Semester ${semester}. Tick a course to enrol in it.`}
            select={{ label: "Enrol", render: checkbox }}
            courseNote={note}
            basketState={stateOf}
            totalHave={totalHave}
            rowClassName={(c) => (changed(c.course_id) ? "bg-primary/5" : undefined)}
          />
        )}
      </div>

      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setShowAll(!expanded)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium text-primary hover:bg-muted/40"
        >
          {expanded ? "Hide" : "Show"} the full study plan (Semesters{" "}
          {semesters[0]}–{semesters[semesters.length - 1]})
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {expanded && (
          <div className="border-t border-border">
            <MinorPlanTable
              plan={minor}
              caption={`${minorTitle(minor.minor)}, the whole study plan.`}
              courseNote={note}
              basketState={stateOf}
              totalHave={totalHave}
            />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
