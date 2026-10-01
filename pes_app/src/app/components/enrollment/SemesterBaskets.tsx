import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CalendarOff,
  GraduationCap,
  Lock,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { EmptyState, ErrorState, SectionCard, StatusBadge } from "../common";
import { cn } from "../ui/utils";
import { supabase } from "../../../lib/supabase";
import { departmentByCourseCode } from "../../../lib/departments";
import type { EnrolmentWindowState } from "./EnrolmentWindow";
import { MinorSelection } from "./MinorSelection";
import {
  minorTitle,
  statusCounts,
  type MinorPlanBasket,
  type MinorPlanCourse,
  type StudentMinorPlan,
} from "../../../lib/minorPlan";

export interface PlanCourse {
  course_id: string;
  course_code: string;
  title: string;
  credits: number;
  contributes_to_gpa: boolean;
  /** The minors whose study plan lists this course in this semester. */
  minor: string | null;
  selected: boolean;
  already_passed: boolean;
  /** A mark has been recorded against this attempt: no longer the student's to undo. */
  locked: boolean;
  /** Whether an open window is actually carrying this course right now. */
  enrollable: boolean;
}

export interface Basket {
  basket: string;
  required_credits: number | null;
  selected_credits: number;
  /** Credits from this basket the student already holds. */
  earned_credits: number;
  available_credits: number;
  /** Whether this round has anything left in the basket to tick. */
  offered_now: boolean;
  courses: PlanCourse[];
}

export interface Plan {
  semester: number;
  academic_year: string;
  department: string;
  window: EnrolmentWindowState | null;
  baskets: Basket[];
  /** The department's minors as its study plan sets them out, with where
      the student stands in each. */
  minor_plan?: StudentMinorPlan;
}

/** One course as it sits in the sheet, carrying the category it belongs to. */
interface Row extends PlanCourse {
  basket: string;
  required_credits: number | null;
}

/**
 * Runs of equal values, as the rowSpan each run's first cell should carry.
 *
 * The handbook writes a category once against the block of courses in it
 * rather than repeating it on every line, and the same for whether they count
 * towards the GPA. Reproducing that means merging vertically down each run;
 * every row after a run's first gets null and prints no cell at all.
 */
function runs<T>(values: T[]): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let i = 0;
  while (i < values.length) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[i]) j++;
    out[i] = j - i + 1;
    i = j + 1;
  }
  return out;
}

/**
 * The semester as the Faculty Handbook prints it.
 *
 * This is the same sheet a student already has in front of them on paper —
 * course code, title, credit value, category, whether it counts towards the
 * GPA — with the category written once against the block of courses it covers.
 * Matching the handbook's layout is the point: a student checking their
 * enrolment against the printed curriculum should be reading the same table
 * twice, not translating between two shapes of the same information.
 *
 * Nothing here refuses anything. A category's requirement is what it asks for,
 * not a ceiling, so a student who wants a third elective may take it; a
 * student who leaves a compulsory course unticked is told plainly and still
 * allowed to submit. The department, not this page, decides what to do about
 * it.
 *
 * Choices stay choices until the window closes. Confirming used to disable the
 * checkbox for good, which made the first click the binding one — students had
 * to be right about an elective before they had read anything about it. Now a
 * tick is a draft until Save, and Save can be run again the next day. What
 * cannot be undone is a course a lecturer has already marked; that one the
 * department has to unpick.
 */
export function SemesterBaskets({
  plan,
  onChanged,
}: {
  plan: Plan;
  onChanged: () => Promise<void> | void;
}) {
  /** Ticks made since the last save, as course_id → wanted. */
  const [draft, setDraft] = useState<Map<string, boolean>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Mandatory minor courses the student is about to save without. */
  const [guard, setGuard] = useState<Row[] | null>(null);

  const open = plan.window?.is_open ?? false;

  // A fresh plan is the truth; anything in flight has either landed or been
  // superseded.
  useEffect(() => {
    setDraft(new Map());
  }, [plan]);

  const chosen = (c: PlanCourse) => draft.get(c.course_id) ?? c.selected;
  // A course the round is not carrying is not a choice the student can make.
  // Asking `enrollable` here is what keeps the checkbox and the Save button
  // agreeing: both are reading the same answer from the same function.
  const editable = (c: PlanCourse) =>
    open && !c.already_passed && !c.locked && c.enrollable;

  const toggle = (c: PlanCourse) => {
    if (!editable(c)) return;
    setDraft((prev) => {
      const next = new Map(prev);
      const want = !chosen(c);
      // Back to where it started is not a change at all.
      if (want === c.selected) next.delete(c.course_id);
      else next.set(c.course_id, want);
      return next;
    });
  };

  /* The whole semester as one flat sheet, in the order the baskets arrive:
     compulsory first, then the electives, then anything optional. */
  const rows = useMemo<Row[]>(
    () =>
      plan.baskets.flatMap((b) =>
        b.courses.map((c) => ({
          ...c,
          basket: b.basket,
          required_credits: b.required_credits,
        })),
      ),
    [plan],
  );

  const categorySpans = useMemo(
    () => runs(rows.map((r) => r.basket)),
    [rows],
  );
  const gpaSpans = useMemo(
    // Keyed by category as well, so a merged GPA cell never runs past the
    // block of courses its category cell covers.
    () => runs(rows.map((r) => `${r.basket}|${r.contributes_to_gpa}`)),
    [rows],
  );

  /* What Save would do, in the two directions the function takes. */
  const { adds, removes } = useMemo(() => {
    const a: Row[] = [];
    const r: Row[] = [];
    rows.forEach((c) => {
      const want = draft.get(c.course_id) ?? c.selected;
      if (want && !c.selected) a.push(c);
      if (!want && c.selected) r.push(c);
    });
    return { adds: a, removes: r };
  }, [rows, draft]);

  const dirty = adds.length + removes.length > 0;

  /* Live totals per category: what is enrolled, plus what has been ticked but
     not yet saved, less what has been unticked -- and plus what the student
     already passed out of the basket. A basket asks for credits, and a credit
     earned two years ago is still a credit it has. */
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((c) => {
      const counts = c.already_passed || (draft.get(c.course_id) ?? c.selected);
      map.set(c.basket, (map.get(c.basket) ?? 0) + (counts ? c.credits : 0));
    });
    return map;
  }, [rows, draft]);

  /* This semester's courses by id, for the minor table: its rows are these
     same courses, ticked through the same draft. */
  const byId = useMemo(() => new Map(rows.map((r) => [r.course_id, r])), [rows]);

  /** Whether a minor-plan course counts toward its basket right now: from
      the draft for this semester's courses, from the record otherwise. */
  const minorCounts = useMemo(
    () => (course: MinorPlanCourse, basket: MinorPlanBasket) => {
      const pc = basket.semester === plan.semester ? byId.get(course.course_id) : undefined;
      return pc ? pc.already_passed || (draft.get(pc.course_id) ?? pc.selected) : statusCounts(course.status);
    },
    [byId, draft, plan.semester],
  );

  /* The minor the student has said they are taking, and this semester's
     part of it. What it still asks of them is said before Save, and its
     mandatory course is not left out without being asked. */
  const takingMinor = plan.minor_plan?.minors.find(
    (m) => m.minor === plan.minor_plan?.chosen_minor,
  );
  const minorBaskets = takingMinor?.baskets.filter((b) => b.semester === plan.semester) ?? [];
  const missingMandatory = useMemo(() => {
    const out: Row[] = [];
    minorBaskets
      .filter((b) => b.mandatory)
      .forEach((b) =>
        b.courses.forEach((c) => {
          const pc = byId.get(c.course_id);
          if (pc && !minorCounts(c, b) && pc.enrollable && !pc.locked) out.push(pc);
        }),
      );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takingMinor, byId, minorCounts, plan.semester]);

  /* Two different things to say. What the student still has to decide, and
     what this round simply is not offering -- which is not their problem to
     solve and must not read as if it were. */
  const { warnings, notOffered } = useMemo(() => {
    const out: string[] = [];
    const absent: string[] = [];
    plan.baskets.forEach((b) => {
      const have = totals.get(b.basket) ?? 0;
      if (b.basket === "Compulsory") {
        const missing = b.courses.filter(
          (c) =>
            !(draft.get(c.course_id) ?? c.selected) &&
            !c.already_passed &&
            c.enrollable,
        );
        if (missing.length > 0) {
          out.push(
            `${missing.length} compulsory course${missing.length === 1 ? "" : "s"} not selected: ${missing
              .map((c) => c.course_code)
              .join(", ")}.`,
          );
        }
      } else if (b.required_credits && have < b.required_credits) {
        if (b.offered_now) {
          out.push(
            `${b.basket} needs ${b.required_credits} credit${b.required_credits === 1 ? "" : "s"} — you have ${have}.`,
          );
        } else {
          absent.push(b.basket);
        }
      }
    });
    if (takingMinor) {
      const title = minorTitle(takingMinor.minor);
      minorBaskets.forEach((b) => {
        if (b.mandatory) {
          b.courses
            .filter((c) => !minorCounts(c, b))
            .forEach((c) =>
              out.push(`${title}: ${c.course_code} ${c.title} is mandatory this semester.`),
            );
        } else {
          const have = b.courses.reduce((n, c) => n + (minorCounts(c, b) ? c.credits : 0), 0);
          if (have < b.min_credits) {
            out.push(
              `${title}: take at least ${b.min_credits} credit${b.min_credits === 1 ? "" : "s"} from ${b.courses
                .map((c) => c.course_code)
                .join(" or ")} — you have ${have}.`,
            );
          }
        }
      });
    }
    return { warnings: out, notOffered: absent };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, totals, draft, takingMinor, minorCounts]);

  /* Save, unless it would leave out a mandatory course of the student's
     minor: then ask first. They may still go ahead -- a minor is optional --
     but not by not noticing. */
  const requestSave = () => {
    if (missingMandatory.length > 0) {
      setGuard(missingMandatory);
      return;
    }
    save();
  };

  const save = async (extra: Row[] = []) => {
    const toAdd = [...adds, ...extra.filter((c) => !adds.includes(c))];
    if (toAdd.length + removes.length === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const { error: rpcError } = await supabase.rpc("update_my_enrolment", {
      p_add: toAdd.map((c) => c.course_id),
      p_remove: removes.map((c) => c.course_id),
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const parts = [
      toAdd.length > 0 &&
        `added ${toAdd.length} course${toAdd.length === 1 ? "" : "s"}`,
      removes.length > 0 &&
        `removed ${removes.length} course${removes.length === 1 ? "" : "s"}`,
    ].filter(Boolean);
    // Only after the reload: it replaces the plan, and setting this first
    // would leave the message describing a state that no longer exists.
    await onChanged();
    setNotice(`Enrolment saved — ${parts.join(" and ")}.`);
  };

  /* What a course's row says about it beyond code, title and credits. The
     same set on the handbook table and on the phone list. */
  const courseBadges = (c: Row) => {
    const want = chosen(c);
    const changed = draft.has(c.course_id);
    return (
      <>
        {c.minor && (
          <StatusBadge tone="info" icon={GraduationCap}>
            {c.minor}
          </StatusBadge>
        )}
        {c.already_passed && <StatusBadge tone="success">Passed</StatusBadge>}
        {c.selected && !c.already_passed && !changed && (
          <StatusBadge tone="success">Enrolled</StatusBadge>
        )}
        {changed && (
          <StatusBadge tone={want ? "brand" : "warning"} icon={want ? Plus : Minus}>
            {want ? "Adding" : "Removing"}
          </StatusBadge>
        )}
        {c.locked && (
          <StatusBadge tone="neutral" icon={Lock}>
            Marks recorded
          </StatusBadge>
        )}
        {/* On the sheet because the handbook puts it there, but not on
            offer in this round. Saying so is the difference between a
            course a student chose not to take and one they were never
            able to. */}
        {open && !c.enrollable && !c.already_passed && !c.selected && (
          <StatusBadge tone="neutral" icon={CalendarOff}>
            Not in this round
          </StatusBadge>
        )}
      </>
    );
  };

  /** A course code in its department's hue, as on every other page. */
  const codeClass = (code: string) =>
    cn("font-semibold tabular-nums", departmentByCourseCode(code)?.textClass ?? "text-foreground");

  /** "2 of 3 credits", coloured by whether the basket is met. */
  const basketProgress = (basket: string, required: number | null) => {
    if (!required) {
      return (
        <span className="text-xs text-muted-foreground">
          {basket === "Compulsory" ? "All required" : "Not required"}
        </span>
      );
    }
    const have = totals.get(basket) ?? 0;
    return (
      <span className={cn("text-xs", have >= required ? "text-success-fg" : "text-warning-fg")}>
        {have} of {required} credits
      </span>
    );
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title={`No curriculum on record for Semester ${plan.semester}`}
        description="Your department sets out each semester's compulsory courses and elective baskets. Ask them to add this one."
      />
    );
  }

  const selectedCredits = rows.reduce(
    (n, c) => n + ((draft.get(c.course_id) ?? c.selected) ? c.credits : 0),
    0,
  );

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} size="inline" />}
      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          {notice}
        </div>
      )}

      {plan.minor_plan && plan.minor_plan.minors.length > 0 && (
        <MinorSelection
          semester={plan.semester}
          plan={plan.minor_plan}
          coursesById={byId}
          counts={minorCounts}
          chosen={chosen}
          editable={editable}
          toggle={toggle}
          changed={(id) => draft.has(id)}
          open={open}
          onMinorChanged={onChanged}
        />
      )}

      <SectionCard
        title={`Semester ${plan.semester}`}
        description="The curriculum as set out in the Faculty Handbook. A category is written once against the block of courses it covers."
        actions={
          <StatusBadge tone="brand">
            {selectedCredits} credit{selectedCredits === 1 ? "" : "s"} selected
          </StatusBadge>
        }
        flush
      >
        {/* Six columns do not fit a phone. Scrolled sideways, the category
            and its credit count (the thing a student is trying to satisfy)
            sat off screen, so a phone gets the same sheet as a list, one
            basket at a time, each headed by what it asks for. The handbook's
            table is kept from the small breakpoint up. */}
        <div className="sm:hidden">
          {plan.baskets.map((b) => {
            const basketRows = rows.filter((r) => r.basket === b.basket);
            if (basketRows.length === 0) return null;
            return (
              <div key={b.basket} className="border-b border-border last:border-b-0">
                <div className="flex items-center justify-between gap-3 bg-muted/60 px-4 py-2">
                  <span className="text-sm font-semibold text-foreground">{b.basket}</span>
                  <span className="flex flex-col items-end">
                    {basketProgress(b.basket, b.required_credits)}
                    <span className="text-[11px] text-muted-foreground">
                      {basketRows.every((r) => r.contributes_to_gpa)
                        ? "Counts toward GPA"
                        : basketRows.some((r) => r.contributes_to_gpa)
                          ? "Partly counts toward GPA"
                          : "Not in GPA"}
                    </span>
                  </span>
                </div>
                <ul className="divide-y divide-border/50">
                  {basketRows.map((c) => {
                    const want = chosen(c);
                    const id = `enrol-${c.course_id}`;
                    return (
                      <li
                        key={c.course_id}
                        className={cn(
                          "flex items-start gap-3 border-l-4 px-4 py-2.5 transition-colors",
                          departmentByCourseCode(c.course_code)?.stripeClass ?? "border-l-transparent",
                          // An unsaved change keeps its own tint; otherwise
                          // the department's shows on hover.
                          draft.has(c.course_id)
                            ? "bg-primary/5"
                            : departmentByCourseCode(c.course_code)?.hoverClass,
                        )}
                      >
                        <Checkbox
                          id={id}
                          className="mt-1"
                          checked={want}
                          disabled={!editable(c)}
                          onCheckedChange={() => toggle(c)}
                          aria-label={`${want ? "Drop" : "Enrol in"} ${c.course_code} ${c.title}`}
                        />
                        <label htmlFor={id} className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-xs">
                            <span className={codeClass(c.course_code)}>{c.course_code}</span>
                            <span className="text-muted-foreground">
                              {c.credits} credit{c.credits === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="block text-sm text-foreground">{c.title}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
                            {courseBadges(c)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <caption className="sr-only">
              Semester {plan.semester} curriculum. Tick a course to enrol in it.
            </caption>
            <thead>
              <tr className="border-y border-border bg-muted/60 text-left">
                <th scope="col" className="w-10 px-3 py-2">
                  <span className="sr-only">Enrol</span>
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Course Code
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Title
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Credit Value
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Category
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Contributing to GPA
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const want = chosen(c);
                const changed = draft.has(c.course_id);
                const catSpan = categorySpans[i];
                const gpaSpan = gpaSpans[i];
                // A run's last row draws the line under the whole block, the
                // way a ruled sheet separates one category from the next.
                const endsBlock =
                  i === rows.length - 1 || rows[i + 1].basket !== c.basket;
                return (
                  <tr
                    key={c.course_id}
                    className={`transition-colors ${
                      changed
                        ? "bg-primary/5"
                        : (departmentByCourseCode(c.course_code)?.hoverClass ?? "")
                    } ${
                      endsBlock ? "border-b border-border" : "border-b border-border/40"
                    }`}
                  >
                    <td className="px-3 py-2 align-top">
                      <Checkbox
                        className="mt-0.5"
                        checked={want}
                        disabled={!editable(c)}
                        onCheckedChange={() => toggle(c)}
                        aria-label={`${want ? "Drop" : "Enrol in"} ${c.course_code} ${c.title}`}
                      />
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap border-l-4 px-3 py-2 align-top",
                        departmentByCourseCode(c.course_code)?.stripeClass ?? "border-l-transparent",
                        codeClass(c.course_code),
                      )}
                    >
                      {c.course_code}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="text-foreground">{c.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
                        {courseBadges(c)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center align-top tabular-nums text-foreground">
                      {c.credits}
                    </td>
                    {/* Merged cells take their own background: they belong to
                        the block's first row, and a tint on that row for an
                        unsaved change would otherwise fill the whole block. */}
                    {catSpan !== null && (
                      <td
                        rowSpan={catSpan}
                        className="border-l border-border bg-card px-3 py-2 align-middle"
                      >
                        <span className="block font-medium text-foreground">
                          {c.basket}
                        </span>
                        <span className="mt-1 block">
                          {basketProgress(c.basket, c.required_credits)}
                        </span>
                      </td>
                    )}
                    {gpaSpan !== null && (
                      <td
                        rowSpan={gpaSpan}
                        className="border-l border-border bg-card px-3 py-2 text-center align-middle text-foreground"
                      >
                        {c.contributes_to_gpa ? "Yes" : "No"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {open && notOffered.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <CalendarOff className="h-4 w-4" aria-hidden="true" />
            Not part of this enrolment round
          </p>
          <p className="mt-1 text-xs">
            {notOffered.join(" and ")}{" "}
            {notOffered.length === 1 ? "is" : "are"} in your semester's
            curriculum but this round is not carrying{" "}
            {notOffered.length === 1 ? "it" : "them"}. Your department opens
            these separately — there is nothing for you to do here.
          </p>
        </div>
      )}

      {open && warnings.length > 0 && (
        <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Before you confirm
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs">
            You can still enrol — this is a note, not a block.
          </p>
        </div>
      )}

      {open && (
        /* Pinned to the bottom of the screen only while there is something
           to save. Idle, it read "No changes" over the sheet the whole time
           the student was reading it. */
        <div
          className={cn(
            "space-y-2 rounded-xl border border-border bg-card/95 p-3",
            dirty && "sticky bottom-3 z-10 shadow-elevation-md backdrop-blur",
          )}
        >
          <p className="text-xs text-muted-foreground">
            {dirty
              ? [
                  adds.length > 0 &&
                    `Adding ${adds.map((c) => c.course_code).join(", ")}`,
                  removes.length > 0 &&
                    `Removing ${removes.map((c) => c.course_code).join(", ")}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Your enrolment is saved. Tick or untick a course to change it — you can do this as often as you like until the window closes."}
          </p>
          {/* The buttons come with something to save. A disabled "No
              changes" bar beside the line saying so only repeated it. */}
          {dirty && (
            <div className="flex gap-2">
              <Button className="flex-1" disabled={saving} onClick={requestSave}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setDraft(new Map())}
              >
                Discard
              </Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={guard !== null} onOpenChange={(o) => !o && setGuard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave out a mandatory minor course?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {takingMinor ? minorTitle(takingMinor.minor) : "Your minor"} requires{" "}
                  {guard?.length === 1 ? "this course" : "these courses"} in Semester{" "}
                  {plan.semester}:
                </p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {guard?.map((c) => (
                    <li key={c.course_id}>
                      <span className="font-semibold text-danger-fg">{c.course_code}</span>{" "}
                      {c.title}
                    </li>
                  ))}
                </ul>
                <p>Without {guard?.length === 1 ? "it" : "them"} you cannot claim the minor.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setGuard(null);
                save();
              }}
            >
              Save without {guard?.length === 1 ? "it" : "them"}
            </Button>
            <Button
              onClick={() => {
                const extra = guard ?? [];
                setGuard(null);
                save(extra);
              }}
            >
              Add {guard?.length === 1 ? "it" : "them"} and save
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
