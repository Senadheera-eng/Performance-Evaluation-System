import { CalendarClock, Lock, LockOpen } from "lucide-react";
import { StatusBadge } from "../common";

export interface EnrolmentWindowState {
  period_id: string;
  title: string;
  opens_at: string;
  closes_at: string;
  is_open: boolean;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Whole days left, rounded up: 23 hours to go is still "1 day left". */
function daysLeft(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/**
 * Whether enrolment is open, and until when.
 *
 * A deadline the student cannot see is not a deadline, it is a surprise. The
 * page behaves differently on either side of this line — before it, every
 * choice can still be changed; after it, none of them can — so the line itself
 * has to be the first thing on the page rather than something inferred from a
 * greyed-out checkbox.
 *
 * Three states, not two. A window that has closed and a window that never
 * opened look identical from the student's side otherwise, and only one of
 * them means they have missed something.
 */
export function EnrolmentWindow({
  window,
  semester,
}: {
  window: EnrolmentWindowState | null;
  semester: number;
}) {
  if (!window) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3">
        <CalendarClock
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            Enrolment has not opened for Semester {semester}
            <StatusBadge tone="neutral" dot>
              Not open
            </StatusBadge>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your department will open it. This is what the semester looks like
            when it does.
          </p>
        </div>
      </div>
    );
  }

  if (!window.is_open) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3">
        <Lock
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            Enrolment is closed
            <StatusBadge tone="neutral" dot>
              Closed
            </StatusBadge>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            It closed on {when(window.closes_at)}. Your selections are final —
            speak to your department if one of them is wrong.
          </p>
        </div>
      </div>
    );
  }

  const left = daysLeft(window.closes_at);
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-success-border bg-success-bg px-4 py-3">
      <LockOpen
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-success-fg"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-success-fg">
          Enrolment is open
          <StatusBadge tone="success" dot>
            Open
          </StatusBadge>
          {left <= 3 && (
            <StatusBadge tone="warning">
              {left <= 0
                ? "Closes today"
                : `${left} day${left === 1 ? "" : "s"} left`}
            </StatusBadge>
          )}
        </p>
        <p className="mt-0.5 text-sm text-success-fg/90">
          You can add or remove courses until {when(window.closes_at)}. After
          that your selections become read-only.
        </p>
      </div>
    </div>
  );
}
