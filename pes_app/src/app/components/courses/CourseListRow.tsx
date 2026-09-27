import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { cn } from "../ui/utils";
import { StatusBadge, useListMotion, type StatusTone } from "../common";
import { departmentByCourseCode } from "../../../lib/departments";
import { useSettings } from "../../../lib/settings";

export type CourseStatus = "ongoing" | "completed" | "upcoming" | "not_recorded";

export interface CourseListItem {
  id: string;
  code: string;
  name: string;
  credits: number;
  status: CourseStatus;
  attendance?: number;
  grade?: string;
  progress?: number;
  category?: string;
  minor_category?: string | null;
}

const STATUS_TONE: Record<CourseStatus, StatusTone> = {
  ongoing: "info",
  completed: "success",
  /* A course still to come is a plain fact, not a warning. It was amber,
     which also read as Computer Engineering's stripe beside it; department
     colour is identity and status must not borrow it. */
  upcoming: "neutral",
  // Deliberately distinct from "upcoming" (see STATUS_OUTLINE): this
  // course's semester has already been reached, it is only missing a record.
  not_recorded: "neutral",
};

/* The two neutral statuses differ by label and by outline, a dashed edge
   marking the record that is missing. */
const STATUS_OUTLINE: Partial<Record<CourseStatus, string>> = {
  not_recorded: "border-dashed",
};

const STATUS_LABEL: Record<CourseStatus, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  upcoming: "Upcoming",
  not_recorded: "Not Recorded",
};

const gradeTone = (grade: string): StatusTone => {
  const g = grade.toUpperCase();
  if (g.startsWith("A")) return "success";
  if (g.startsWith("B")) return "info";
  if (g.startsWith("C") || g.startsWith("D")) return "warning";
  if (g === "F" || g === "R") return "danger";
  return "neutral";
};

const TONE_TEXT: Record<StatusTone, string> = {
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
  info: "text-info-fg",
  neutral: "text-muted-foreground",
  brand: "text-primary",
};

/**
 * The one headline number for a course, picked by what the course actually
 * has: a final grade once it is graded, otherwise live attendance, otherwise
 * continuous-assessment progress. Only one is shown so the row stays a
 * single line — the full breakdown lives on Results and Attendance.
 */
function primaryMetric(
  course: CourseListItem,
  threshold: number,
  prewarning: number,
): {
  value: string;
  label: string;
  tone: StatusTone;
} | null {
  if (course.grade) {
    return { value: course.grade, label: "Grade", tone: gradeTone(course.grade) };
  }
  if (course.attendance !== undefined) {
    return {
      value: `${course.attendance}%`,
      label: "Attendance",
      /* The same three bands as the dashboard and the Attendance page, from
         the faculty's configured threshold rather than a literal 80. */
      tone:
        course.attendance < threshold
          ? "danger"
          : course.attendance < prewarning
            ? "warning"
            : "success",
    };
  }
  if (course.progress !== undefined) {
    return {
      value: `${course.progress}%`,
      label: "Continuous assessment progress",
      tone: "neutral",
    };
  }
  return null;
}

interface CourseListRowProps {
  course: CourseListItem;
  index?: number;
  onClick?: () => void;
}

/**
 * Compact single-line course row.
 *
 * Replaces the tall card grid on the Courses page: a student following the
 * full curriculum has 70+ courses, and the cards showed only a handful per
 * screen. Everything sits in fixed-width slots so the code, credits, metric
 * and status line up into readable columns down the list — a plain flex row
 * with variable-width content read as a jumble.
 *
 * The minor is rendered as trailing text inside the (truncating) title
 * rather than as its own badge. As a badge it was a fixed block in the
 * middle of the row that stole width from every title around it, which is
 * what turned "Machine Learning" into "Ma…"; as trailing text it costs no
 * layout and is the first thing dropped when a name is genuinely too long.
 *
 * The left edge carries the owning department's Handbook colour and the
 * code is set in its hue, so a department's own modules and the shared
 * Interdisciplinary ones separate at a glance. The code itself names the
 * department, so colour is never the only cue.
 */
export function CourseListRow({ course, index = 0, onClick }: CourseListRowProps) {
  const listMotion = useListMotion(index);
  const settings = useSettings();
  const metric = primaryMetric(
    course,
    settings.attendanceThreshold,
    settings.attendancePrewarningThreshold,
  );
  const dept = departmentByCourseCode(course.code);
  const interactive = Boolean(onClick);

  const fullTitle = course.minor_category
    ? `${course.name} · ${course.minor_category}`
    : course.name;

  const body = (
    <>
      <span
        className={cn(
          "w-[3.75rem] flex-shrink-0 text-sm font-semibold tabular-nums",
          dept?.textClass ?? "text-foreground",
        )}
      >
        {course.code}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm" title={fullTitle}>
        <span className="text-foreground">{course.name}</span>
        {course.minor_category && (
          <span className="text-muted-foreground"> · {course.minor_category}</span>
        )}
      </span>

      <span className="hidden w-10 flex-shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
        {course.credits} cr
      </span>

      <span className="hidden w-11 flex-shrink-0 text-right sm:block">
        {metric && (
          <span
            aria-label={`${metric.label}: ${metric.value}`}
            className={cn(
              "text-sm font-semibold tabular-nums",
              TONE_TEXT[metric.tone],
            )}
          >
            {metric.value}
          </span>
        )}
      </span>

      {/* Status always carries its label — colour never conveys it alone. */}
      <StatusBadge
        tone={STATUS_TONE[course.status]}
        dot
        className={cn(
          "flex-shrink-0 sm:w-[7rem] sm:justify-center",
          STATUS_OUTLINE[course.status],
        )}
      >
        {STATUS_LABEL[course.status]}
      </StatusBadge>

      {interactive && (
        <ChevronRight
          className="h-4 w-4 flex-shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </>
  );

  const className = cn(
    "flex w-full items-center gap-2.5 rounded-lg border border-l-4 border-border bg-card",
    "px-3 py-2 text-left transition-colors",
    dept?.stripeClass,
    interactive && "hover:bg-muted/50",
  );

  return (
    <motion.div {...listMotion}>
      {interactive ? (
        <button type="button" onClick={onClick} className={className}>
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
    </motion.div>
  );
}
