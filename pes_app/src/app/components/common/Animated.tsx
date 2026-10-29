import { useEffect, useRef } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { cn } from "../ui/utils";
import { EASE } from "./motion";
import type { StatusTone } from "./StatusBadge";

/**
 * A number that counts up to its value the first time it comes into view,
 * and glides to a new value when it changes. Screen readers get the final
 * value at once; reduced motion shows it without counting.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const finite = Number.isFinite(value);
  const mv = useMotionValue(reduce || !finite ? value : 0);
  const text = useTransform(mv, (v) => `${v.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    if (!finite) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    if (!inView) return;
    const controls = animate(mv, value, { duration: 0.8, ease: EASE });
    return () => controls.stop();
  }, [value, inView, reduce, finite, mv]);

  if (!finite) return <span className={className}>—</span>;
  return (
    <span className={cn("tabular-nums", className)}>
      <motion.span ref={ref} aria-hidden="true">
        {text}
      </motion.span>
      <span className="sr-only">
        {value.toFixed(decimals)}
        {suffix}
      </span>
    </span>
  );
}

const BAR_TONE: Record<StatusTone | "hero", string> = {
  success: "bg-[var(--status-success-fg)]",
  warning: "bg-[var(--status-warning-fg)]",
  danger: "bg-[var(--status-danger-fg)]",
  info: "bg-[var(--status-info-fg)]",
  neutral: "bg-[var(--status-neutral-fg)]",
  brand: "bg-primary",
  hero: "bg-primary",
};

/**
 * A progress bar that fills from empty when it first appears. On a hero card
 * (tone "hero") it is white on a translucent track.
 */
export function AnimatedBar({
  value,
  max = 100,
  tone = "brand",
  label,
  className,
  marker,
}: {
  value: number;
  max?: number;
  tone?: StatusTone | "hero";
  label: string;
  className?: string;
  /** A marker on the track, e.g. the 80% attendance requirement. */
  marker?: number;
}) {
  const reduce = useReducedMotion();
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const markerPct = marker !== undefined && max > 0 ? Math.max(0, Math.min(100, (marker / max) * 100)) : null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn(
        "relative h-2 overflow-hidden rounded-full",
        tone === "hero" ? "bg-[var(--hero-track)]" : "bg-muted",
        className,
      )}
    >
      <motion.div
        className={cn("h-full rounded-full", BAR_TONE[tone])}
        initial={{ width: reduce ? `${pct}%` : 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: reduce ? 0 : 0.7, ease: EASE }}
      />
      {markerPct !== null && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 w-0.5",
            tone === "hero" ? "bg-white/70" : "bg-foreground/40",
          )}
          style={{ left: `${markerPct}%` }}
        />
      )}
    </div>
  );
}
