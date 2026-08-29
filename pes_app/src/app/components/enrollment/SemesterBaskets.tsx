import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Lock,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { EmptyState, ErrorState, SectionCard, StatusBadge } from "../common";
import { supabase } from "../../../lib/supabase";
import type { EnrolmentWindowState } from "./EnrolmentWindow";

export interface PlanCourse {
  course_id: string;
  course_code: string;
  title: string;
  credits: number;
  contributes_to_gpa: boolean;
  minor: string | null;
  selected: boolean;
  already_passed: boolean;
  /** A mark has been recorded against this attempt: no longer the student's to undo. */
  locked: boolean;
}

export interface Basket {
  basket: string;
  required_credits: number | null;
  selected_credits: number;
  available_credits: number;
  courses: PlanCourse[];
}

export interface MinorProgress {
  minor: string;
  required_credits: number;
  earned_credits: number;
  selected_credits: number;
  status: "complete" | "partial" | "none";
}

export interface Plan {
  semester: number;
  academic_year: string;
  department: string;
  window: EnrolmentWindowState | null;
  baskets: Basket[];
  minors: MinorProgress[];
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

  const open = plan.window?.is_open ?? false;

  // A fresh plan is the truth; anything in flight has either landed or been
  // superseded.
  useEffect(() => {
    setDraft(new Map());
  }, [plan]);

  const chosen = (c: PlanCourse) => draft.get(c.course_id) ?? c.selected;
  const editable = (c: PlanCourse) => open && !c.already_passed && !c.locked;

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

  /* Live totals per category, counting what is enrolled plus what has been
     ticked but not yet saved, less what has been unticked. */
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((c) => {
      const want = draft.get(c.course_id) ?? c.selected;
      map.set(c.basket, (map.get(c.basket) ?? 0) + (want ? c.credits : 0));
    });
    return map;
  }, [rows, draft]);

  /* What the pending ticks would do to each minor. The server counts credits
     already earned and already enrolled; only this semester's unsaved changes
     are missing from that, and every course carrying them is on this page. */
  const minorDelta = useMemo(() => {
    const map = new Map<string, number>();
    const move = (c: Row, sign: number) => {
      if (!c.minor) return;
      map.set(c.minor, (map.get(c.minor) ?? 0) + sign * c.credits);
    };
    adds.forEach((c) => move(c, 1));
    removes.forEach((c) => move(c, -1));
    return map;
  }, [adds, removes]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    plan.baskets.forEach((b) => {
      const have = totals.get(b.basket) ?? 0;
      if (b.basket === "Compulsory") {
        const missing = b.courses.filter(
          (c) => !(draft.get(c.course_id) ?? c.selected) && !c.already_passed,
        );
        if (missing.length > 0) {
          out.push(
            `${missing.length} compulsory course${missing.length === 1 ? "" : "s"} not selected: ${missing
              .map((c) => c.course_code)
              .join(", ")}.`,
          );
        }
      } else if (b.required_credits && have < b.required_credits) {
        out.push(
          `${b.basket} needs ${b.required_credits} credit${b.required_credits === 1 ? "" : "s"} — you have ${have}.`,
        );
      }
    });
    return out;
  }, [plan, totals, draft]);

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const { error: rpcError } = await supabase.rpc("update_my_enrolment", {
      p_add: adds.map((c) => c.course_id),
      p_remove: removes.map((c) => c.course_id),
    });
    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const parts = [
      adds.length > 0 &&
        `added ${adds.length} course${adds.length === 1 ? "" : "s"}`,
      removes.length > 0 &&
        `removed ${removes.length} course${removes.length === 1 ? "" : "s"}`,
    ].filter(Boolean);
    // Only after the reload: it replaces the plan, and setting this first
    // would leave the message describing a state that no longer exists.
    await onChanged();
    setNotice(`Enrolment saved — ${parts.join(" and ")}.`);
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

      {plan.minors.length > 0 && (
        <SectionCard
          title="Minors"
          description="Optional. A minor is claimed once you have completed enough credits from its courses — across the whole degree, not one semester."
        >
          <ul className="space-y-2">
            {plan.minors.map((m) => {
              const have = Math.max(
                0,
                m.earned_credits +
                  m.selected_credits +
                  (minorDelta.get(m.minor) ?? 0),
              );
              const short = Math.max(0, m.required_credits - have);
              // Recomputed rather than read off the plan: the badge has to
              // follow the ticks, or unticking the last course of a minor
              // would leave it reading Complete.
              const status =
                have >= m.required_credits
                  ? "complete"
                  : have > 0
                    ? "partial"
                    : "none";
              return (
                <li key={m.minor} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {m.minor}
                  </span>
                  {status === "complete" ? (
                    <StatusBadge tone="success" icon={CheckCircle2}>
                      Complete
                    </StatusBadge>
                  ) : status === "partial" ? (
                    <StatusBadge tone="warning">
                      {short} more credit{short === 1 ? "" : "s"} needed
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Not selected</StatusBadge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {have} of {m.required_credits} credits
                    {m.earned_credits > 0 &&
                      ` · ${m.earned_credits} already passed`}
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionCard>
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
        {/* Six columns do not fit a phone, and squeezing them would cost the
            handbook's shape. The sheet scrolls sideways inside its own box
            instead, so the page itself never does. */}
        <div className="overflow-x-auto">
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
                const have = totals.get(c.basket) ?? 0;
                const met = c.required_credits
                  ? have >= c.required_credits
                  : true;
                // A run's last row draws the line under the whole block, the
                // way a ruled sheet separates one category from the next.
                const endsBlock =
                  i === rows.length - 1 || rows[i + 1].basket !== c.basket;
                return (
                  <tr
                    key={c.course_id}
                    className={`${changed ? "bg-primary/5" : ""} ${
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
                    <td className="whitespace-nowrap px-3 py-2 align-top font-semibold text-primary">
                      {c.course_code}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="text-foreground">{c.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
                        {c.minor && (
                          <StatusBadge tone="info" icon={GraduationCap}>
                            {c.minor}
                          </StatusBadge>
                        )}
                        {c.already_passed && (
                          <StatusBadge tone="success">Passed</StatusBadge>
                        )}
                        {c.selected && !c.already_passed && !changed && (
                          <StatusBadge tone="success">Enrolled</StatusBadge>
                        )}
                        {changed && (
                          <StatusBadge
                            tone={want ? "brand" : "warning"}
                            icon={want ? Plus : Minus}
                          >
                            {want ? "Adding" : "Removing"}
                          </StatusBadge>
                        )}
                        {c.locked && (
                          <StatusBadge tone="neutral" icon={Lock}>
                            Marks recorded
                          </StatusBadge>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center align-top tabular-nums text-foreground">
                      {c.credits}
                    </td>
                    {catSpan !== null && (
                      <td
                        rowSpan={catSpan}
                        className="border-l border-border px-3 py-2 align-middle"
                      >
                        <span className="block font-medium text-foreground">
                          {c.basket}
                        </span>
                        {c.required_credits ? (
                          <span
                            className={`mt-1 block text-xs ${
                              met ? "text-success-fg" : "text-warning-fg"
                            }`}
                          >
                            {have} of {c.required_credits} credits
                          </span>
                        ) : (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {c.basket === "Compulsory"
                              ? "All required"
                              : "Not required"}
                          </span>
                        )}
                      </td>
                    )}
                    {gpaSpan !== null && (
                      <td
                        rowSpan={gpaSpan}
                        className="border-l border-border px-3 py-2 text-center align-middle text-foreground"
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
        <div className="sticky bottom-3 space-y-2 rounded-xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
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
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
            </Button>
            {dirty && (
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setDraft(new Map())}
              >
                Discard
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
