import { motion } from "framer-motion";
import { AlertCircle, RefreshCw, type LucideIcon } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";
import { usePageMotion } from "./motion";

/* ------------------------------------------------------------------ */
/* Empty                                                               */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** `inline` fits inside a card; `page` centres in a full page region. */
  size?: "inline" | "page";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = "page",
}: EmptyStateProps) {
  const motionProps = usePageMotion();
  return (
    <motion.div
      {...motionProps}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "page" ? "py-14 px-6" : "py-8 px-4",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-card bg-primary/8 ring-1 ring-inset ring-primary/15 flex items-center justify-center mb-3",
          size === "page" ? "h-14 w-14" : "h-11 w-11",
        )}
      >
        <Icon
          className={cn(
            "text-primary",
            size === "page" ? "h-7 w-7" : "h-5 w-5",
          )}
          aria-hidden="true"
        />
      </div>
      <h3
        className={cn(
          "font-semibold text-foreground",
          size === "page" ? "text-base" : "text-sm",
        )}
      >
        {title}
      </h3>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Error                                                               */
/* ------------------------------------------------------------------ */

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
  size?: "inline" | "page";
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
  size = "page",
}: ErrorStateProps) {
  const motionProps = usePageMotion();
  return (
    <motion.div
      {...motionProps}
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center rounded-card",
        "border border-danger-border bg-danger-bg/40",
        size === "page" ? "py-12 px-6" : "py-7 px-4",
        className,
      )}
    >
      <AlertCircle
        className={cn(
          "text-danger-fg mb-3",
          size === "page" ? "h-8 w-8" : "h-6 w-6",
        )}
        aria-hidden="true"
      />
      <h3 className="font-semibold text-foreground text-sm">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          Try again
        </Button>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/**
 * A loading block with a light sweeping across it. Width/height come from the
 * caller via className, or via `style` when the dimension is computed (chart
 * heights, for instance). Reduced motion leaves it still.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn("skeleton-shimmer rounded-control bg-muted", className)}
      style={style}
      aria-hidden="true"
    />
  );
}

/** Matches the footprint of a StatCard so the grid doesn't shift on load. */
export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-card" />
      ))}
    </div>
  );
}

export function SkeletonRows({
  count = 4,
  height = "h-16",
}: {
  count?: number;
  height?: string;
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={height} />
      ))}
    </div>
  );
}

/** The footprint of a HeroCard, so the page doesn't jump when it arrives. */
export function SkeletonHero({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-card border border-border bg-card p-5 sm:p-6", className)} aria-hidden="true">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-12 w-40" />
      <Skeleton className="mt-3 h-3 w-64 max-w-full" />
      <Skeleton className="mt-5 h-2 w-full max-w-md rounded-full" />
    </div>
  );
}
