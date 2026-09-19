import { motion, useReducedMotion } from "framer-motion";
import { cn } from "../ui/utils";
import type { StatusTone } from "./StatusBadge";

interface ProgressRingProps {
  /** 0–100. Values outside the range are clamped. */
  value: number;
  size?: number;
  strokeWidth?: number;
  tone?: StatusTone;
  label?: string;
  sublabel?: string;
  /** Optional threshold marker, e.g. the 80% attendance requirement. */
  threshold?: number;
  className?: string;
}

const TONE_STROKE: Record<StatusTone, string> = {
  success: "var(--status-success-fg)",
  warning: "var(--status-warning-fg)",
  danger: "var(--status-danger-fg)",
  info: "var(--status-info-fg)",
  neutral: "var(--status-neutral-fg)",
  brand: "var(--primary)",
};

/**
 * Compact radial progress indicator.
 *
 * Used where a single percentage would otherwise become a full-width bar
 * with no comparison value — the "one course, one giant bar" problem.
 */
export function ProgressRing({
  value,
  size = 104,
  strokeWidth = 9,
  tone = "brand",
  label,
  sublabel,
  threshold,
  className,
}: ProgressRingProps) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  // Threshold tick, drawn as a short radial notch on the track.
  const thresholdAngle =
    threshold !== undefined ? (threshold / 100) * 360 - 90 : null;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label ?? "Progress"}: ${pct}%${
        threshold !== undefined ? `, requirement ${threshold}%` : ""
      }`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TONE_STROKE[tone]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: reduce ? offset : circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: reduce ? 0 : 0.6, ease: [0.4, 0, 0.2, 1] }}
        />
        {thresholdAngle !== null && (
          <line
            x1={size / 2 + (radius - strokeWidth / 2) * Math.cos((thresholdAngle * Math.PI) / 180)}
            y1={size / 2 + (radius - strokeWidth / 2) * Math.sin((thresholdAngle * Math.PI) / 180)}
            x2={size / 2 + (radius + strokeWidth / 2) * Math.cos((thresholdAngle * Math.PI) / 180)}
            y2={size / 2 + (radius + strokeWidth / 2) * Math.sin((thresholdAngle * Math.PI) / 180)}
            stroke="var(--foreground)"
            strokeWidth={2}
            opacity={0.45}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-foreground tabular-nums leading-none">
          {pct}
          <span className="text-sm font-semibold">%</span>
        </span>
        {sublabel && (
          <span className="text-[10px] text-muted-foreground mt-0.5">
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}
