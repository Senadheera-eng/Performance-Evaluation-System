import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  BookOpen,
  CalendarOff,
  CheckCircle2,
  GraduationCap,
  Lock,
  Minus,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  EmptyState,
  ErrorState,
  SPRING,
  SectionCard,
  StatusBadge,
  StickyActionBar,
} from "../common";
import { cn } from "../ui/utils";
import { supabase } from "../../../lib/supabase";
import { departmentByCourseCode } from "../../../lib/departments";
import type { EnrolmentWindowState } from "./EnrolmentWindow";
import { MinorSelection } from "./MinorSelection";
import { MinorShortfallAlert } from "../minors/MinorProgress";
import {
  minorShortfalls,
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
 * The semester as the Faculty Handbook sets it out.
 *
 * On a laptop or wider it is the handbook's own table — course code, title,
 * credit value, category, contributing to GPA — with the Category and GPA
 * cells merged down each basket exactly as the printed sheet merges them, a
 * tick box in front of each course, and under each category, live, how much
 * of what it asks for the ticks so far supply. Students already know that
 * sheet, so the page reads like it. A phone has no room for six columns, so
 * there each category heads its own list instead, and a course that is the
 * exception in its block says so on its own row.
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
  /** Mandatory minor courses the student is about to save without. */
  const [guard, setGuard] = useState<Row[] | null>(null);

  const open = plan.window?.is_open ?? false;
  const reduce = useReducedMotion();

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
    return { warnings: out, notOffered: absent };
  }, [plan, totals, draft]);

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

    const { error: rpcError } = await supabase.rpc("update_my_enrolment", {
      p_add: toAdd.map((c) => c.course_id),
      p_remove: removes.map((c) => c.course_id),
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      toast.error("Your enrolment was not saved", { description: rpcError.message });
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
    toast.success("Enrolment saved", { description: `You ${parts.join(" and ")}.` });
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

  /** "2 of 3 credits", coloured by whether the basket is met, with a tick
      that springs in the moment it is. */
  const basketProgress = (basket: string, required: number | null) => {
    if (!required) {
      return (
        <span className="text-xs text-muted-foreground">
          {basket === "Compulsory" ? "All required" : "Not required"}
        </span>
      );
    }
    const have = totals.get(basket) ?? 0;
    const met = have >= required;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
          met ? "text-success-fg" : "text-warning-fg",
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {met && (
            <motion.span
              key="met"
              initial={reduce ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }}
              transition={reduce ? { duration: 0 } : SPRING}
              className="inline-flex"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            </motion.span>
          )}
        </AnimatePresence>
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
    // Room under the last block while the action bar floats over it.
    <div className={cn("space-y-4", open && dirty && "pb-36 sm:pb-24")}>
      {error && <ErrorState message={error} size="inline" />}

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
        description="The curriculum as set out in the Faculty Handbook: compulsory courses, then each elective basket and the credits it asks for."
        actions={
          <StatusBadge tone="brand">
            {selectedCredits} credit{selectedCredits === 1 ? "" : "s"} selected
          </StatusBadge>
        }
        flush
      >
        {/* A phone: each category heads its own list. */}
        <div className="md:hidden">
          <p className="sr-only">
            Semester {plan.semester} curriculum. Tick a course to enrol in it.
          </p>
          {plan.baskets.map((b) => {
            const basketRows = rows.filter((r) => r.basket === b.basket);
            if (basketRows.length === 0) return null;
            const allInGpa = basketRows.every((r) => r.contributes_to_gpa);
            const noneInGpa = basketRows.every((r) => !r.contributes_to_gpa);
            return (
              <div key={b.basket} className="border-b border-border last:border-b-0">
                {/* The category once, with what it asks for and how much of
                    that the ticks so far supply. */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-muted/50 px-4 py-2 sm:px-5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{b.basket}</span>
                    {!allInGpa && (
                      <StatusBadge tone="neutral">
                        {noneInGpa ? "Not in GPA" : "Partly in GPA"}
                      </StatusBadge>
                    )}
                  </span>
                  {basketProgress(b.basket, b.required_credits)}
                </div>
                <ul className="divide-y divide-border/50">
                  {basketRows.map((c) => {
                    const want = chosen(c);
                    const id = `enrol-${c.course_id}`;
                    const dept = departmentByCourseCode(c.course_code);
                    return (
                      <li
                        key={c.course_id}
                        className={cn(
                          "flex items-start gap-3 border-l-4 px-4 py-2.5 transition-colors sm:items-center sm:px-5",
                          dept?.stripeClass ?? "border-l-transparent",
                          // An unsaved change keeps its own tint; otherwise
                          // the department's shows on hover.
                          draft.has(c.course_id) ? "bg-primary/5" : dept?.hoverClass,
                        )}
                      >
                        <Checkbox
                          id={id}
                          className="mt-1 transition-transform active:scale-90 sm:mt-0"
                          checked={want}
                          disabled={!editable(c)}
                          onCheckedChange={() => toggle(c)}
                          aria-label={`${want ? "Drop" : "Enrol in"} ${c.course_code} ${c.title}`}
                        />
                        <label
                          htmlFor={id}
                          className={cn(
                            "flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3",
                            editable(c) && "cursor-pointer",
                          )}
                        >
                          <span className="flex items-center gap-2 text-xs sm:w-[4.75rem] sm:flex-shrink-0 sm:text-sm">
                            <span className={codeClass(c.course_code)}>{c.course_code}</span>
                            <span className="text-muted-foreground sm:hidden">
                              {c.credits} credit{c.credits === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm text-foreground">{c.title}</span>
                            {courseBadges(c)}
                            {/* The exception in a block that otherwise counts. */}
                            {!c.contributes_to_gpa && !noneInGpa && (
                              <StatusBadge tone="neutral">Not in GPA</StatusBadge>
                            )}
                          </span>
                          <span className="hidden w-14 flex-shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">
                            {c.credits} cr
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

        {/* A laptop or wider: the handbook's table. The table's own outer
            border is hidden so the card's edge is the only frame; inside,
            every cell is ruled as on the printed sheet. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-collapse border-hidden text-sm">
            <caption className="sr-only">
              Semester {plan.semester} curriculum. Tick a course to enrol in it.
            </caption>
            <thead>
              <tr className="bg-muted/70 text-xs font-semibold text-foreground">
                <th scope="col" className="w-12 border border-border px-3 py-2.5">
                  <span className="sr-only">Enrol</span>
                </th>
                <th scope="col" className="w-24 border border-border px-3 py-2.5 text-left">
                  Course code
                </th>
                <th scope="col" className="border border-border px-3 py-2.5 text-left">
                  Title
                </th>
                <th scope="col" className="w-20 border border-border px-3 py-2.5 text-center">
                  Credit value
                </th>
                <th scope="col" className="w-40 border border-border px-3 py-2.5 text-center">
                  Category
                </th>
                <th scope="col" className="w-24 border border-border px-3 py-2.5 text-center">
                  Contributing to GPA
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.baskets.flatMap((b) => {
                const basketRows = rows.filter((r) => r.basket === b.basket);
                if (basketRows.length === 0) return [];
                // One merged GPA cell when the whole basket agrees, as the
                // handbook prints it; a cell per course when it does not.
                const allInGpa = basketRows.every((r) => r.contributes_to_gpa);
                const noneInGpa = basketRows.every((r) => !r.contributes_to_gpa);
                const oneGpaCell = allInGpa || noneInGpa;
                const gpaText = (yes: boolean) => (
                  <span className={yes ? "text-foreground" : "text-muted-foreground"}>
                    {yes ? "Yes" : "No"}
                  </span>
                );
                return basketRows.map((c, i) => {
                  const want = chosen(c);
                  const id = `enrol-table-${c.course_id}`;
                  const dept = departmentByCourseCode(c.course_code);
                  return (
                    <tr
                      key={c.course_id}
                      className={cn(
                        "transition-colors",
                        draft.has(c.course_id) ? "bg-primary/5" : dept?.hoverClass,
                      )}
                    >
                      <td className="relative border border-border px-3 py-2 text-center align-middle">
                        {/* The course's department, as the stripe on every list. */}
                        <span
                          className={cn("absolute inset-y-0 left-0 w-1", dept?.swatchClass)}
                          aria-hidden="true"
                        />
                        <Checkbox
                          id={id}
                          className="align-middle transition-transform active:scale-90"
                          checked={want}
                          disabled={!editable(c)}
                          onCheckedChange={() => toggle(c)}
                          aria-label={`${want ? "Drop" : "Enrol in"} ${c.course_code} ${c.title}`}
                        />
                      </td>
                      <td className="border border-border px-3 py-2 align-middle">
                        <label
                          htmlFor={id}
                          className={cn(codeClass(c.course_code), editable(c) && "cursor-pointer")}
                        >
                          {c.course_code}
                        </label>
                      </td>
                      <td className="border border-border px-3 py-2 align-middle">
                        <label
                          htmlFor={id}
                          className={cn(
                            "flex flex-wrap items-center gap-x-2 gap-y-1",
                            editable(c) && "cursor-pointer",
                          )}
                        >
                          <span className="text-foreground">{c.title}</span>
                          {courseBadges(c)}
                        </label>
                      </td>
                      <td className="border border-border px-3 py-2 text-center align-middle tabular-nums">
                        {c.credits}
                      </td>
                      {/* The merged cells are painted solid, so the first
                          row's hover or unsaved tint stays on that row and
                          does not spread over the whole basket. */}
                      {i === 0 && (
                        <td
                          rowSpan={basketRows.length}
                          className="border border-border bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))] px-3 py-2 text-center align-middle"
                        >
                          <p className="font-medium text-foreground">{b.basket}</p>
                          <p className="mt-1">{basketProgress(b.basket, b.required_credits)}</p>
                        </td>
                      )}
                      {oneGpaCell ? (
                        i === 0 && (
                          <td
                            rowSpan={basketRows.length}
                            className="border border-border bg-card px-3 py-2 text-center align-middle"
                          >
                            {gpaText(allInGpa)}
                          </td>
                        )
                      ) : (
                        <td className="border border-border px-3 py-2 text-center align-middle">
                          {gpaText(c.contributes_to_gpa)}
                        </td>
                      )}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
        {open && !dirty && (
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
            Your enrolment is saved. Tick or untick a course to change it — you
            can do this as often as you like until the window closes.
          </p>
        )}
      </SectionCard>

      {open && notOffered.length > 0 && (
        <div className="rounded-card border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
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

      {/* The minor the student is taking, in red: it is the one thing on
          this page they chose to commit to, and leaving its course out
          costs them the minor. */}
      {open && takingMinor && (
        <MinorShortfallAlert
          minor={takingMinor.minor}
          semester={plan.semester}
          shortfalls={minorShortfalls(takingMinor, plan.semester, minorCounts)}
          hint="Tick them in the minor table or the semester list above, or stop taking the minor."
        />
      )}

      {open && warnings.length > 0 && (
        <div className="rounded-card border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-fg">
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

      {/* Rises from the bottom only while there is something to save, over
          the page's column and never the sidebar. Idle, the line at the foot
          of the semester card says the enrolment is saved. */}
      <StickyActionBar
        open={open && dirty}
        summary={
          <>
            <p className="font-medium">
              {[
                adds.length > 0 && `Adding ${adds.map((c) => c.course_code).join(", ")}`,
                removes.length > 0 &&
                  `Removing ${removes.map((c) => c.course_code).join(", ")}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedCredits} credit{selectedCredits === 1 ? "" : "s"} selected once saved
            </p>
          </>
        }
      >
        <Button variant="outline" disabled={saving} onClick={() => setDraft(new Map())}>
          Discard
        </Button>
        <Button disabled={saving} onClick={requestSave}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </StickyActionBar>

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
