import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { useChartMotion } from "./motion";

/**
 * A small line with no axes: the shape of a trend at a glance, for a hero
 * card. The full chart, with axes and values, is elsewhere on the page; this
 * is decoration that carries meaning, so it is hidden from screen readers
 * and the caption beside it says what it shows.
 */
export function Sparkline({
  data,
  className,
}: {
  data: { label: string; value: number }[];
  /** Kept for callers on a hero card. The hero is a light surface now, so
   *  the line is the brand colour wherever it sits. */
  onHero?: boolean;
  className?: string;
}) {
  const duration = useChartMotion();
  return (
    <div className={className ?? "h-16 w-44"} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 6 }}>
          <YAxis hide domain={["dataMin - 0.15", "dataMax + 0.15"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={2.25}
            dot={{ r: 2.5, fill: "var(--primary)", strokeWidth: 0 }}
            isAnimationActive={duration > 0}
            animationDuration={duration * 1.6}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
