import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, GraduationCap } from "lucide-react";
import { Button } from "../ui/button";
import { StatusBadge } from "../common";
import { cn } from "../ui/utils";
import type { BasketState } from "./MinorPlanTable";
import {
  describeShortfall,
  minorTitle,
  planSemesters,
  setMyMinor,
  type MinorPlan,
  type MinorPlanBasket,
  type MinorShortfall,
} from "../../../lib/minorPlan";

/**
 * Semester by semester through a minor's plan: what is met, what is now,
 * what comes later. The same row on the Enrollment page and on My Courses.
 */
export function MinorSemesterChips({
  minor,
  semester,
  stateOf,
}: {
  minor: MinorPlan;
  /** The student's current semester. */
  semester: number;
  stateOf: (b: MinorPlanBasket) => BasketState;
}) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Progress through the minor">
      {planSemesters(minor).map((s) => {
        const baskets = minor.baskets.filter((b) => b.semester === s);
        const have = baskets.reduce((n, b) => n + Math.min(stateOf(b).have, b.min_credits), 0);
        const need = baskets.reduce((n, b) => n + b.min_credits, 0);
        const met = baskets.every((b) => stateOf(b).met);
        const now = s === semester;
        const later = s > semester;
        return (
          <li
            key={s}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              met
                ? "border-success-border bg-success-bg text-success-fg"
                : later
                  ? "border-border bg-muted/40 text-muted-foreground"
                  : now
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-danger-border bg-danger-bg text-danger-fg",
              now && "ring-2 ring-primary/30",
            )}
          >
            {met && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
            <span className="font-medium">Semester {s}</span>
            <span className="tabular-nums">
              {have}/{need}
            </span>
            {now && <span className="font-medium">· now</span>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Whether the student is taking this minor, and the button to say so. Saying
 * so is what lets enrolment warn them about its courses.
 */
export function MinorDeclaration({
  chosenMinor,
  minor,
  onChanged,
}: {
  chosenMinor: string | null;
  minor: string;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taking = chosenMinor === minor;

  const declare = async (value: string | null) => {
    setBusy(true);
    setError(null);
    const result = await setMyMinor(value);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await onChanged();
  };

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      {taking ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="success" icon={CheckCircle2}>
            You're taking this minor
          </StatusBadge>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => declare(null)}>
            Stop taking it
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => declare(minor)}>
          <GraduationCap className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {chosenMinor ? "Switch to this minor" : "I'm taking this minor"}
        </Button>
      )}
      {error && <p className="text-xs text-danger-fg">{error}</p>}
    </div>
  );
}

/**
 * What the minor a student is taking still asks of them this semester, in
 * red: the mandatory courses not selected, and the elective baskets short of
 * their minimum. Renders nothing when the semester is covered.
 */
export function MinorShortfallAlert({
  minor,
  semester,
  shortfalls,
  hint,
  className,
}: {
  minor: string;
  semester: number;
  shortfalls: MinorShortfall[];
  /** What to do about it; by default, tick the courses below. */
  hint?: ReactNode;
  className?: string;
}) {
  if (shortfalls.length === 0) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger-fg",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        {minorTitle(minor)}: not selected for Semester {semester}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-6 text-xs">
        {shortfalls.map((s) => (
          <li key={s.kind === "mandatory" ? `m-${s.course.course_id}` : `e-${s.basket.id}`}>
            {describeShortfall(s)}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs">
        Without {shortfalls.length === 1 ? "it" : "these"} you cannot claim the minor.{" "}
        {hint ?? (
          <>
            Tick {shortfalls.length === 1 ? "it" : "them"} below, or stop taking the minor.
          </>
        )}
      </p>
    </div>
  );
}
