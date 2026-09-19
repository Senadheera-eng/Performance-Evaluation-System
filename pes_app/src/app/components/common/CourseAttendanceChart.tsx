import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip } from "./ChartContainer";
import { useChartMotion } from "./motion";
import type { StatusTone } from "./StatusBadge";

export interface CourseAttendancePoint {
  code: string;
  /** 0–100. Only pass courses that actually have lectures recorded. */
  percentage: number;
}

const TONE_VAR: Record<StatusTone, string> = {
  success: "var(--status-success-fg)",
  warning: "var(--status-warning-fg)",
  danger: "var(--status-danger-fg)",
  info: "var(--status-info-fg)",
  neutral: "var(--status-neutral-fg)",
  brand: "var(--primary)",
};

interface CourseAttendanceChartProps {
  title: string;
  description?: string;
  data: CourseAttendancePoint[];
  /** Required minimum, drawn as a reference line. */
  threshold: number;
  /** Soft warning tier, used only to colour bars. */
  prewarning?: number;
  /**
   * Courses awaiting their first recorded lecture. Excluded from the plot —
   * a course with no lectures is not 0% attendance — but surfaced in the
   * subtitle so the omission is visible rather than silent.
   */
  awaitingCount?: number;
  /** Show only the N lowest courses; the rest are summarised in the header. */
  limit?: number;
  loading?: boolean;
  className?: string;
}

/**
 * Per-course attendance as horizontal bars against the faculty threshold.
 *
 * Vertical bars were unreadable here: course codes collided on the x-axis,
 * and when only one course had data a single bar stretched across the entire
 * plot. Horizontal bars give each course a labelled row, keep bar thickness
 * constant regardless of how many courses have data, and put the threshold
 * line where it can actually be compared against.
 */
export function CourseAttendanceChart({
  title,
  description,
  data,
  threshold,
  prewarning,
  awaitingCount = 0,
  limit,
  loading = false,
  className,
}: CourseAttendanceChartProps) {
  const chartDuration = useChartMotion();

  const sorted = [...data].sort((a, b) => a.percentage - b.percentage);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const hidden = sorted.length - shown.length;

  const toneFor = (pct: number): StatusTone => {
    if (pct < threshold) return "danger";
    if (prewarning !== undefined && pct < prewarning) return "warning";
    return "success";
  };

  const notes: string[] = [];
  if (hidden > 0) notes.push(`${hidden} more not shown`);
  if (awaitingCount > 0) {
    notes.push(
      awaitingCount === 1
        ? "1 course awaiting its first recorded lecture"
        : `${awaitingCount} courses awaiting their first recorded lecture`,
    );
  }
  const subtitle = [description, ...notes].filter(Boolean).join(" · ");

  // One row per course, so the plot grows with the data instead of
  // stretching a lone bar across the full width.
  const height = Math.max(180, Math.min(shown.length, limit ?? 12) * 34 + 44);

  return (
    <ChartContainer
      title={title}
      description={subtitle || undefined}
      height={height}
      loading={loading}
      hasData={shown.length > 0}
      emptyTitle="No attendance recorded yet"
      emptyDescription={
        awaitingCount > 0
          ? "Attendance appears here once lectures are marked for these courses."
          : "Attendance appears here once lectures are marked."
      }
      summary={`Attendance by course against a ${threshold}% requirement: ${shown
        .map((d) => `${d.code} ${d.percentage}%`)
        .join(", ")}.`}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={shown}
          layout="vertical"
          margin={{ top: 4, right: 44, left: 4, bottom: 4 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            horizontal={false}
          />
          <XAxis
            type="number"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="code"
            width={72}
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={<ChartTooltip valueSuffix="%" />}
          />
          <ReferenceLine
            x={threshold}
            stroke="var(--status-danger-fg)"
            strokeDasharray="4 4"
            label={{
              value: `${threshold}% required`,
              position: "top",
              fill: "var(--status-danger-fg)",
              fontSize: 10,
            }}
          />
          <Bar
            dataKey="percentage"
            name="Attendance"
            radius={[0, 5, 5, 0]}
            barSize={16}
            animationDuration={chartDuration}
            isAnimationActive={chartDuration > 0}
          >
            {shown.map((d) => (
              <Cell key={d.code} fill={TONE_VAR[toneFor(d.percentage)]} />
            ))}
            <LabelList
              dataKey="percentage"
              position="right"
              formatter={(v: number) => `${v}%`}
              fill="var(--muted-foreground)"
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
