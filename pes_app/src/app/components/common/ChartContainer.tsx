import { motion, useReducedMotion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { cn } from "../ui/utils";
import { EmptyState, ErrorState, Skeleton } from "./States";
import { DURATION, EASE } from "./motion";

interface ChartContainerProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Height of the plot area. Fixed so loading never shifts layout. */
  height?: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Chart renders only when true; otherwise the empty state shows. */
  hasData: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Plain-language description of what the chart shows, announced to screen
   * readers. Charts are otherwise opaque to assistive technology.
   */
  summary?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Standard wrapper for every chart: consistent titling, a fixed-height plot
 * area that prevents layout shift, and first-class loading, empty and error
 * states so a chart never renders as a blank rectangle.
 */
export function ChartContainer({
  title,
  description,
  actions,
  height = 260,
  loading = false,
  error = null,
  onRetry,
  hasData,
  emptyTitle = "No data to display yet",
  emptyDescription,
  summary,
  children,
  className,
}: ChartContainerProps) {
  const reduce = useReducedMotion();

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card shadow-elevation-sm overflow-hidden",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/70">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
        )}
      </header>

      <div className="p-4">
        {loading ? (
          <Skeleton style={{ height }} className="w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} size="inline" />
        ) : !hasData ? (
          <div style={{ minHeight: height }} className="flex items-center">
            <EmptyState
              icon={BarChart3}
              title={emptyTitle}
              description={emptyDescription}
              size="inline"
              className="w-full"
            />
          </div>
        ) : (
          <>
            {summary && <p className="sr-only">{summary}</p>}
            {/* The plot fades and lifts in as it replaces the loading
                skeleton, so the chart reads as arriving rather than snapping
                into place. This runs alongside the marks' own draw animation
                — Recharts starts that on mount, which is this same moment. */}
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduce ? 0 : DURATION.slow,
                ease: EASE,
              }}
              style={{ height }}
              aria-hidden={summary ? "true" : undefined}
            >
              {children}
            </motion.div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Recharts tooltip replacement. The default is unstyled and ignores the
 * theme, so tooltips were unreadable in dark mode.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  valueSuffix = "",
  labelFormatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
  valueSuffix?: string;
  labelFormatter?: (label: string | number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 shadow-elevation-lg">
      {label !== undefined && (
        <p className="text-xs font-semibold text-popover-foreground mb-1">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="space-y-0.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {entry.color && (
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: entry.color }}
                aria-hidden="true"
              />
            )}
            {entry.name && (
              <span className="text-muted-foreground">{entry.name}</span>
            )}
            <span className="font-semibold text-popover-foreground tabular-nums ml-auto">
              {entry.value}
              {valueSuffix}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
