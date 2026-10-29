import { useId, useState } from "react";
import {
  AlertTriangle,
  Award,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "../ui/utils";
import { departmentByCourseCode } from "../../../lib/departments";
import {
  AnimatedBar,
  AnimatedNumber,
  DepartmentDot,
  EmptyState,
  ProgressRing,
  SectionCard,
  StatStrip,
  StatusBadge,
  cardReveal,
  useExpandMotion,
  useListMotion,
  type StatusTone,
  type StripItem,
} from "../common";
import {
  TIER_LABEL,
  classifyTier,
  percentageOf,
  totalCount,
  type AttendanceCounts,
  type AttendanceTier,
} from "../../../lib/attendanceMath";

export const TIER_TONE: Record<AttendanceTier, StatusTone> = {
  excellent: "success",
  safe: "info",
  at_risk: "warning",
  critical: "danger",
  pending: "neutral",
};

export const TIER_ICON: Record<AttendanceTier, LucideIcon> = {
  excellent: Award,
  safe: ShieldCheck,
  at_risk: AlertTriangle,
  critical: ShieldAlert,
  pending: CalendarClock,
};

const TONE_TEXT: Record<StatusTone, string> = {
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
  info: "text-info-fg",
  neutral: "text-muted-foreground",
  brand: "text-primary",
};

/** Percentages arrive rounded to one place; a whole one shows none. */
const places = (pct: number) => (Number.isInteger(pct) ? 0 : 1);

/** One delivery of a course, with its attendance already reduced to numbers. */
export interface CourseAttendanceSummary {
  id: string;
  code: string;
  name: string;
  counts: AttendanceCounts;
  total: number;
  percentage: number;
  tier: AttendanceTier;
  absencesAllowed: number;
  lecturesNeeded: number;
  /** Set only for a course the student has sat more than once. */
  attempt?: { label: string; isLatest: boolean };
}

/**
 * A percentage that matters, as a ring against the requirement, with its
 * verdict and the counts behind it. The overview uses it for the semester as
 * a whole; the calendar view for the course being looked at.
 */
export function AttendanceSummaryCard({
  eyebrow,
  percentage,
  total,
  tier,
  threshold,
  headline,
  message,
  items,
}: {
  eyebrow: React.ReactNode;
  percentage: number;
  /** Lectures recorded. With none there is no percentage to draw. */
  total: number;
  tier: AttendanceTier;
  threshold: number;
  headline: React.ReactNode;
  message?: React.ReactNode;
  items: StripItem[];
}) {
  const reduce = useReducedMotion();
  const tone = TIER_TONE[tier];
  return (
    <motion.section
      variants={cardReveal}
      initial={reduce ? false : "hidden"}
      animate="show"
      className="rounded-card border border-primary/15 surface-tint p-5 shadow-elevation-sm sm:p-6"
    >
      {/* Ring beside the verdict on every screen; on a phone the detail
          runs under both, full width, so the ring never sits alone. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 sm:gap-x-7">
        <div className="sm:row-span-2">
          {total > 0 ? (
            <>
              <ProgressRing
                value={percentage}
                size={92}
                strokeWidth={9}
                tone={tone}
                threshold={threshold}
                label="Attendance"
                className="sm:hidden"
              />
              <ProgressRing
                value={percentage}
                size={128}
                strokeWidth={11}
                tone={tone}
                threshold={threshold}
                label="Attendance"
                sublabel={`${threshold}% needed`}
                className="hidden sm:inline-flex"
              />
            </>
          ) : (
            <div
              className="flex h-[92px] w-[92px] items-center justify-center rounded-full border-[9px] border-muted sm:h-32 sm:w-32 sm:border-[11px]"
              role="img"
              aria-label="No lectures recorded yet"
            >
              <span className="text-2xl font-bold leading-none text-muted-foreground sm:text-3xl">—</span>
            </div>
          )}
        </div>
        <div className="min-w-0 sm:self-end">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <StatusBadge tone={tone} icon={TIER_ICON[tier]}>
              {TIER_LABEL[tier]}
            </StatusBadge>
            <p className="text-base font-semibold text-foreground">{headline}</p>
          </div>
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:self-start">
          {message && <p className="max-w-2xl text-sm text-muted-foreground">{message}</p>}
          <StatStrip className={message ? "mt-3" : undefined} items={items} />
        </div>
      </div>
    </motion.section>
  );
}

interface AttendanceOverviewProps {
  summaries: CourseAttendanceSummary[];
  threshold: number;
  /** Jumps to the calendar for one course. */
  onOpenCalendar: (courseId: string) => void;
}

/**
 * Every enrolled course's attendance on one screen.
 *
 * The calendar answers "which lectures did I miss in this course"; it can
 * only ever show one course at a time. This answers the question a student
 * actually opens the page with — "am I in trouble anywhere?" — without
 * making them step through the course dropdown one entry at a time.
 */
export function AttendanceOverview({
  summaries,
  threshold,
  onOpenCalendar,
}: AttendanceOverviewProps) {
  // A course sat twice is judged on the second attempt. The first still
  // appears in the list below — it is the student's record — but counting it
  // in the headline would mean a term already served dragging the figure the
  // student is measured on now.
  const current = summaries.filter((s) => !s.attempt || s.attempt.isLatest);
  const tracked = current.filter((s) => s.total > 0);

  const overallCounts = tracked.reduce<AttendanceCounts>(
    (acc, s) => ({
      present: acc.present + s.counts.present,
      absent: acc.absent + s.counts.absent,
      excused: acc.excused + s.counts.excused,
    }),
    { present: 0, absent: 0, excused: 0 },
  );
  const overallTotal = totalCount(overallCounts);
  const overallPercentage = percentageOf(overallCounts);
  // The overall figure is a headline, not an eligibility verdict — eligibility
  // is always per course — so it is classified with the same tiers but read
  // as a summary of where the student stands across the board.
  const overallTier = classifyTier(
    overallPercentage,
    overallTotal,
    threshold,
    threshold,
  );

  const meeting = tracked.filter((s) => s.percentage >= threshold).length;
  const needsAttention = tracked.filter(
    (s) => s.tier === "critical" || s.tier === "at_risk",
  ).length;
  const awaiting = current.length - tracked.length;

  // Worst first: the courses that need action are the reason to open this
  // page. Courses with nothing recorded yet carry no signal, so they sit at
  // the end rather than at 0%, and a superseded attempt sits behind them
  // both — it is history, and nothing can be done about it now.
  const ordered = [...summaries].sort((a, b) => {
    const aPast = a.attempt !== undefined && !a.attempt.isLatest;
    const bPast = b.attempt !== undefined && !b.attempt.isLatest;
    if (aPast !== bPast) return aPast ? 1 : -1;
    const aEmpty = a.total === 0;
    const bEmpty = b.total === 0;
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    return a.percentage - b.percentage || a.code.localeCompare(b.code);
  });
  const isPast = (s: CourseAttendanceSummary) => s.attempt !== undefined && !s.attempt.isLatest;
  const recorded = ordered.filter((s) => !isPast(s) && s.total > 0);
  const notStarted = ordered.filter((s) => !isPast(s) && s.total === 0);
  const past = ordered.filter(isPast);

  // Courses with nothing recorded fold into one row, so the one course that
  // has a register is not lost among six that say "not started". Before any
  // lecture is marked that row is all there is, so it starts open.
  const [showNotStarted, setShowNotStarted] = useState(() => recorded.length === 0);

  const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

  return (
    <div className="space-y-4">
      <AttendanceSummaryCard
        eyebrow="Overall attendance · this semester"
        percentage={overallPercentage}
        total={overallTotal}
        tier={overallTier}
        threshold={threshold}
        headline={
          tracked.length > 0
            ? `At or above ${threshold}% in ${meeting} of ${tracked.length} ${plural(tracked.length, "course")}`
            : "No lectures recorded yet"
        }
        message={
          needsAttention > 0
            ? `${needsAttention} ${plural(needsAttention, "course is", "courses are")} below or close to ${threshold}%, listed first below. Eligibility is judged course by course.`
            : tracked.length > 0
              ? "Across this semester's courses with recorded lectures. Eligibility is judged course by course."
              : "Your attendance appears here once your lecturers start marking registers."
        }
        items={[
          { label: plural(overallTotal, "lecture"), value: overallTotal, icon: CalendarCheck2 },
          {
            label: "missed",
            value: overallCounts.absent,
            icon: CalendarX2,
            tone: overallCounts.absent > 0 ? "danger" : "neutral",
          },
          { label: "excused", value: overallCounts.excused, icon: ShieldCheck, tone: "info" },
          {
            label: "need attention",
            value: needsAttention,
            icon: AlertTriangle,
            tone: needsAttention > 0 ? "danger" : "success",
          },
          {
            label: "awaiting records",
            value: awaiting,
            icon: CalendarClock,
            onClick: notStarted.length > 0 ? () => setShowNotStarted(true) : undefined,
          },
        ]}
      />

      <SectionCard
        title="Course by course"
        description="Lowest attendance first. Select a course to open its calendar."
        flush
      >
        {ordered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={CalendarX2}
              title="No enrolled courses"
              description="Attendance appears here once you are enrolled in courses."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {recorded.map((summary, index) => (
              <CourseRow
                key={summary.id}
                summary={summary}
                index={index}
                threshold={threshold}
                onOpen={() => onOpenCalendar(summary.id)}
              />
            ))}
            {notStarted.length > 0 && (
              <NotStartedGroup
                courses={notStarted}
                index={recorded.length}
                open={showNotStarted}
                onToggle={() => setShowNotStarted((o) => !o)}
                threshold={threshold}
                onOpenCalendar={onOpenCalendar}
              />
            )}
            {past.map((summary, index) => (
              <CourseRow
                key={summary.id}
                summary={summary}
                index={recorded.length + 1 + index}
                threshold={threshold}
                onOpen={() => onOpenCalendar(summary.id)}
              />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/** "6 courses awaiting their first recorded lecture", opening to the six. */
function NotStartedGroup({
  courses,
  index,
  open,
  onToggle,
  threshold,
  onOpenCalendar,
}: {
  courses: CourseAttendanceSummary[];
  index: number;
  open: boolean;
  onToggle: () => void;
  threshold: number;
  onOpenCalendar: (courseId: string) => void;
}) {
  const listMotion = useListMotion(index);
  const expand = useExpandMotion();
  const listId = useId();
  return (
    <motion.li {...listMotion}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full items-center gap-3 border-l-4 border-l-transparent px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {courses.length} course{courses.length === 1 ? "" : "s"} awaiting{" "}
            {courses.length === 1 ? "its" : "their"} first recorded lecture
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
            {courses.map((c) => {
              const dept = departmentByCourseCode(c.code);
              return (
                <span key={c.id} className="inline-flex items-center gap-1">
                  {dept && <DepartmentDot dept={dept} className="h-2 w-2" />}
                  <span className={cn("font-medium tabular-nums", dept?.textClass ?? "text-muted-foreground")}>
                    {c.code}
                  </span>
                </span>
              );
            })}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            id={listId}
            key="not-started"
            variants={expand}
            initial="collapsed"
            animate="open"
            exit="collapsed"
            className="divide-y divide-border/50 overflow-hidden border-t border-border/50 bg-muted/30"
          >
            {courses.map((summary, i) => (
              <CourseRow
                key={summary.id}
                summary={summary}
                index={i}
                threshold={threshold}
                onOpen={() => onOpenCalendar(summary.id)}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function CourseRow({
  summary,
  index,
  threshold,
  onOpen,
}: {
  summary: CourseAttendanceSummary;
  index: number;
  threshold: number;
  onOpen: () => void;
}) {
  const listMotion = useListMotion(index);
  const tone = TIER_TONE[summary.tier];
  const Icon = TIER_ICON[summary.tier];
  const dept = departmentByCourseCode(summary.code);

  const past = summary.attempt !== undefined && !summary.attempt.isLatest;

  const hint =
    past
      ? "Replaced by a later attempt"
      : summary.total === 0
      ? "Not started"
      : summary.tier === "critical"
        ? `${summary.lecturesNeeded} lecture${
            summary.lecturesNeeded === 1 ? "" : "s"
          } to recover`
        : `${summary.absencesAllowed} absence${
            summary.absencesAllowed === 1 ? "" : "s"
          } left`;

  return (
    <motion.li {...listMotion}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group w-full border-l-4 px-4 py-3 text-left transition-colors",
          // The department's stripe, and its tint on hover; the bar and
          // figures below keep the status colours.
          dept?.stripeClass ?? "border-l-transparent",
          dept?.hoverClass ?? "hover:bg-muted/50",
          // The course that most needs the student leads with a wash of its
          // status, so it reads first even before its number does.
          !past && summary.tier === "critical" && "bg-danger-bg/50",
          !past && summary.tier === "at_risk" && "bg-warning-bg/50",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  dept?.textClass ?? "text-foreground",
                )}
              >
                {summary.code}
              </span>
              <span className="truncate text-sm text-foreground">
                {summary.name}
              </span>
              {summary.attempt && (
                <StatusBadge
                  tone={summary.attempt.isLatest ? "info" : "neutral"}
                  className="flex-shrink-0"
                >
                  {summary.attempt.label}
                </StatusBadge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {summary.total === 0
                ? "No lectures recorded yet"
                : `${summary.counts.present} present · ${summary.counts.absent} absent · ${summary.counts.excused} excused · ${summary.total} lecture${
                    summary.total === 1 ? "" : "s"
                  }`}
            </p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3">
            <div className="text-right">
              <p
                className={cn(
                  "text-lg font-bold tabular-nums",
                  TONE_TEXT[tone],
                )}
              >
                {summary.total === 0 ? (
                  "—"
                ) : (
                  <AnimatedNumber
                    value={summary.percentage}
                    decimals={places(summary.percentage)}
                    suffix="%"
                  />
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">{hint}</p>
            </div>
            <StatusBadge tone={tone} icon={Icon} className="hidden sm:inline-flex">
              {TIER_LABEL[summary.tier]}
            </StatusBadge>
            <ChevronRight
              className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Bar with the eligibility threshold marked, so a percentage is read
            against the rule it has to clear rather than against 100%. A
            course with no lectures has nothing to draw. */}
        {summary.total > 0 && (
          <AnimatedBar
            value={summary.percentage}
            max={100}
            tone={tone}
            marker={threshold}
            label={`${summary.percentage}% attendance, ${threshold}% required`}
            className="mt-2 h-1.5"
          />
        )}
      </button>
    </motion.li>
  );
}
