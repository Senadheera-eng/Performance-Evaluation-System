import { motion, useReducedMotion } from "framer-motion";
import { cn } from "../ui/utils";

export interface SegmentedTabItem {
  value: string;
  label: string;
  count?: number;
}

interface SegmentedTabsProps {
  tabs: SegmentedTabItem[];
  value: string;
  onChange: (value: string) => void;
  /** Unique per instance so multiple tab groups animate independently. */
  layoutId: string;
  className?: string;
  /** Horizontal scroll instead of wrapping — for long semester lists. */
  scrollable?: boolean;
  "aria-label"?: string;
}

/**
 * Segmented control with an animated active indicator.
 *
 * Uses real tab semantics (role="tablist"/"tab" with aria-selected) so the
 * active state is announced, not just coloured, and adds an underline on the
 * active item so selection survives greyscale and colour-blind viewing.
 */
export function SegmentedTabs({
  tabs,
  value,
  onChange,
  layoutId,
  className,
  scrollable = false,
  "aria-label": ariaLabel,
}: SegmentedTabsProps) {
  const reduce = useReducedMotion();

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex gap-1 p-1 rounded-xl bg-muted/70 border border-border/60",
        scrollable && "overflow-x-auto max-w-full no-scrollbar",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative flex items-center justify-center gap-1.5 whitespace-nowrap",
              "min-h-[36px] px-3 rounded-lg text-sm font-medium transition-colors",
              active
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-primary shadow-elevation-sm"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", bounce: 0.15, duration: 0.4 }
                }
              />
            )}
            <span className="relative z-10">{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={cn(
                  "relative z-10 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                  active
                    ? "bg-white/25 text-primary-foreground"
                    : "bg-foreground/10 text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
