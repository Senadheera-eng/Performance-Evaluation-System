import {
  AlertTriangle,
  Award,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../ui/utils";
import { departmentByCourseCode } from "../../../lib/departments";
import {
  EmptyState,
  SectionCard,
  StatCard,
  StatusBadge,
  useListMotion,
  type StatusTone,
} from "../common";
import { motion } from "framer-motion";
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

const TONE_BAR: Record<StatusTone, string> = {
  success: "var(--status-success-fg)",
  warning: "var(--status-warning-fg)",
  danger: "var(--status-danger-fg)",
  info: "var(--status-info-fg)",
  neutral: "var(--status-neutral-fg)",
  brand: "var(--primary)",
};

const TONE_TEXT: Record<StatusTone, string> = {
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
  info: "text-info-fg",
  neutral: "text-muted-foreground",
  brand: "text-primary",
};

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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          index={0}
          label="Overall Attendance"
          value={overallTotal > 0 ? `${overallPercentage}%` : "—"}
          icon={TIER_ICON[overallTier]}
          tone={TIER_TONE[overallTier]}
          hint="Across this semester's courses"
        />
        <StatCard
          index={1}
          label="Total Lectures"
          value={overallTotal}
          icon={CalendarCheck2}
          tone="neutral"
          hint={`${overallCounts.absent} missed`}
        />
        <StatCard
          index={2}
          label="Meeting Requirement"
          value={tracked.length > 0 ? `${meeting}/${tracked.length}` : "—"}
          icon={ShieldCheck}
          tone={
            tracked.length > 0 && meeting === tracked.length
              ? "success"
              : "neutral"
          }
          hint={`Courses at or above ${threshold}%`}
        />
        <StatCard
          index={3}
          label="Needs Attention"
          value={needsAttention}
          icon={AlertTriangle}
          tone={needsAttention > 0 ? "danger" : "success"}
          hint={`Below or close to ${threshold}%`}
        />
        <StatCard
          index={4}
          label="Awaiting Records"
          value={awaiting}
          icon={CalendarClock}
          tone="neutral"
          hint="No lectures marked yet"
        />
      </div>

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
            {ordered.map((summary, index) => (
              <CourseRow
                key={summary.id}
                summary={summary}
                index={index}
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
          "w-full border-l-4 px-4 py-3 text-left transition-colors hover:bg-muted/50",
          departmentByCourseCode(summary.code)?.stripeClass ?? "border-l-transparent",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  departmentByCourseCode(summary.code)?.textClass ?? "text-foreground",
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
                {summary.total === 0 ? "—" : `${summary.percentage}%`}
              </p>
              <p className="text-[11px] text-muted-foreground">{hint}</p>
            </div>
            <StatusBadge tone={tone} icon={Icon} className="hidden sm:inline-flex">
              {TIER_LABEL[summary.tier]}
            </StatusBadge>
            <ChevronRight
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Bar with the eligibility threshold marked, so a percentage is read
            against the rule it has to clear rather than against 100%. */}
        <div
          className="relative mt-2 h-1.5 w-full rounded-full bg-muted"
          role="img"
          aria-label={`${summary.percentage}% attendance, ${threshold}% required`}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${summary.total === 0 ? 0 : summary.percentage}%`,
              backgroundColor: TONE_BAR[tone],
            }}
          />
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -bottom-0.5 w-px bg-foreground/40"
            style={{ left: `${threshold}%` }}
          />
        </div>
      </button>
    </motion.li>
  );
}
