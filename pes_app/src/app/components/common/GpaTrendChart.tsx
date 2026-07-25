import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip } from "./ChartContainer";
import { useChartMotion } from "./motion";

export interface GpaTrendPoint {
  /** Axis label, e.g. "Sem 3". */
  semester: string;
  gpa: number;
}

interface GpaTrendChartProps {
  data: GpaTrendPoint[];
  /** Drawn as a labelled reference line so a semester reads against it. */
  cgpa: number;
  title?: string;
  description?: string;
  height?: number;
  loading?: boolean;
  className?: string;
}

/**
 * Semester GPA over time on a fixed 0–4 axis.
 *
 * The axis is deliberately not auto-scaled: a run of 3.4–3.7 on an
 * auto-scaled axis looks like a rollercoaster, which is what made the old
 * trend read as dramatic movement it did not have.
 */
export function GpaTrendChart({
  data,
  cgpa,
  title = "GPA trend",
  description = "Semester GPA against your cumulative average.",
  height = 250,
  loading = false,
  className,
}: GpaTrendChartProps) {
  const chartDuration = useChartMotion();
  // Unique per instance — two charts sharing a gradient id collide.
  const gradientId = `gpaFill-${title.replace(/\W+/g, "-")}`;

  return (
    <ChartContainer
      title={title}
      description={description}
      height={height}
      loading={loading}
      hasData={data.length > 0}
      emptyTitle="No graded semesters yet"
      emptyDescription="Your GPA trend appears once results are published."
      summary={`Semester GPA by semester: ${data
        .map((p) => `${p.semester} ${p.gpa.toFixed(2)}`)
        .join(", ")}. Cumulative GPA ${cgpa.toFixed(2)} out of 4.00.`}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
              <stop
                offset="100%"
                stopColor="var(--primary)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="semester"
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 4]}
            ticks={[0, 1, 2, 3, 4]}
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={
              <ChartTooltip labelFormatter={(l) => `${l} — semester GPA`} />
            }
          />
          <ReferenceLine
            y={cgpa}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: `CGPA ${cgpa.toFixed(2)}`,
              position: "insideTopRight",
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }}
          />
          <Area
            type="monotone"
            dataKey="gpa"
            name="Semester GPA"
            stroke="none"
            fill={`url(#${gradientId})`}
            animationDuration={chartDuration}
          />
          <Line
            type="monotone"
            dataKey="gpa"
            name="Semester GPA"
            stroke="var(--primary)"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "var(--primary)", strokeWidth: 0 }}
            activeDot={{ r: 6 }}
            animationDuration={chartDuration}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
