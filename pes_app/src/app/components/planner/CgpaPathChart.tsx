import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "../common/ChartContainer";
import { useChartMotion } from "../common/motion";
import type { PathPoint } from "../../../lib/graduationPlan";

interface CgpaPathChartProps {
  data: PathPoint[];
  /** The class the path heads for, drawn as one labelled line. */
  target: { label: string; threshold: number };
  /** What the dashed part assumes, in a few words. */
  assumption: string;
}

/* Hover: the semester, and the CGPA on the record or projected. */
function PathTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as PathPoint | undefined;
  if (!p) return null;
  const value = p.actual ?? p.projected;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-elevation-md">
      <p className="font-medium text-foreground">After Semester {label}</p>
      <p className="mt-0.5 text-muted-foreground">
        {p.actual !== null ? "CGPA" : "Projected CGPA"}{" "}
        <span className="font-semibold tabular-nums text-foreground">{value?.toFixed(2)}</span>
      </p>
    </div>
  );
}

/**
 * The CGPA after each semester: solid where it is on the record, dashed
 * where it is projected, against the one class line the student is aiming
 * for. One series in one colour: the line is the CGPA, and the dashing says
 * which part is still to happen.
 */
export function CgpaPathChart({ data, target, assumption }: CgpaPathChartProps) {
  const duration = useChartMotion();
  const last = data[data.length - 1];
  const finish = last?.projected ?? last?.actual ?? null;
  const values = data.flatMap((p) => [p.actual, p.projected]).filter((v): v is number => v !== null);
  // A fixed floor at 2.00 (Pass) keeps a 3.4-3.7 record from looking like a
  // rollercoaster; it drops lower only when the record does.
  const floor = Math.min(2, Math.floor(Math.min(...values, target.threshold) * 2) / 2);
  const ticks = [floor, 2, 2.5, 3, 3.5, 4].filter((t, i, a) => t >= floor && a.indexOf(t) === i);

  return (
    <ChartContainer
      title="Your CGPA path"
      description={`Solid: your record. Dashed: ${assumption}.`}
      height={220}
      hasData={data.length > 0}
      emptyTitle="No graded semesters yet"
      emptyDescription="Your CGPA path appears once results are published."
      summary={`CGPA after each semester: ${data
        .map((p) => `Semester ${p.semester} ${(p.actual ?? p.projected)?.toFixed(2)}${p.actual === null ? " projected" : ""}`)
        .join(", ")}. ${target.label} needs ${target.threshold.toFixed(2)}.${
        finish !== null ? ` The path finishes at ${finish.toFixed(2)}.` : ""
      }`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="semester"
            tickFormatter={(s) => `Sem ${s}`}
            // Room for the first and last points, which sit on the edges.
            padding={{ left: 14, right: 14 }}
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[floor, 4]}
            ticks={ticks}
            tickFormatter={(v) => v.toFixed(1)}
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip cursor={{ stroke: "var(--border)", strokeWidth: 1 }} content={<PathTooltip />} />
          <ReferenceLine
            y={target.threshold}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            label={{
              value: `${target.label} ${target.threshold.toFixed(2)}`,
              position: "insideBottomLeft",
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }}
          />
          <Line
            type="linear"
            dataKey="actual"
            name="CGPA"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={duration > 0}
            animationDuration={duration}
          />
          <Line
            type="linear"
            dataKey="projected"
            name="Projected CGPA"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 4, fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={duration > 0}
            animationDuration={duration}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
