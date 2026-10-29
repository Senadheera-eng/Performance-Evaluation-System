import { motion, useReducedMotion } from "framer-motion";
import { CalendarClock, Lock, LockOpen, type LucideIcon } from "lucide-react";
import { AnimatedNumber, StatusBadge, cardReveal } from "../common";
import { cn } from "../ui/utils";

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
  const reduce = useReducedMotion();
  const strip = (tone: string, children: React.ReactNode) => (
    <motion.section
      variants={cardReveal}
      initial={reduce ? false : "hidden"}
      animate="show"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border px-4 py-4 shadow-elevation-sm sm:px-5",
        tone,
      )}
    >
      {children}
    </motion.section>
  );
  const iconChip = (Icon: LucideIcon, color: string) => (
    <span
      className={cn(
        "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-card/70 ring-1 ring-inset ring-current/15",
        color,
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
  );

  if (!window) {
    return strip(
      "border-border bg-muted/40",
      <>
        {iconChip(CalendarClock, "text-muted-foreground")}
        <div className="min-w-0 flex-1 basis-[16rem]">
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
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
      </>,
    );
  }

  if (!window.is_open) {
    return strip(
      "border-border bg-muted/40",
      <>
        {iconChip(Lock, "text-muted-foreground")}
        <div className="min-w-0 flex-1 basis-[16rem]">
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
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
      </>,
    );
  }

  const left = daysLeft(window.closes_at);
  // The last three days are a warning, not good news.
  const urgent = left <= 3;
  return strip(
    "border-success-border bg-success-bg",
    <>
      {iconChip(LockOpen, "text-success-fg")}
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-success-fg">
          Enrolment is open
          <StatusBadge tone="success" dot>
            Open
          </StatusBadge>
        </p>
        <p className="mt-0.5 text-sm text-success-fg/90">
          You can add or remove courses until {when(window.closes_at)}. After
          that your selections become read-only.
        </p>
      </div>
      {/* The countdown, large: the one number on this strip that changes
          what the student should do today. */}
      <div
        className={cn(
          "flex items-baseline gap-1.5 rounded-control bg-card/70 px-3.5 py-2 ring-1 ring-inset",
          urgent ? "text-warning-fg ring-warning-border" : "text-success-fg ring-success-border",
        )}
      >
        {left <= 0 ? (
          <span className="text-xl font-bold">Closes today</span>
        ) : (
          <>
            <span className="text-3xl font-bold leading-none tabular-nums">
              <AnimatedNumber value={left} />
            </span>
            <span className="text-sm font-medium">day{left === 1 ? "" : "s"} left</span>
          </>
        )}
      </div>
    </>,
  );
}
