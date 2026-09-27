import { motion } from "framer-motion";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "../ui/utils";
import { usePageMotion, useHoverLift, useListMotion } from "./motion";
import { StatusBadge, type StatusTone } from "./StatusBadge";

/* ------------------------------------------------------------------ */
/* PageHeader                                                          */
/* ------------------------------------------------------------------ */

interface PageHeaderProps {
  title: React.ReactNode;
  description?: string;
  /** Primary action(s) for this page, right-aligned on desktop. */
  actions?: React.ReactNode;
  /** Contextual line above the title, e.g. a scope or breadcrumb. */
  eyebrow?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: PageHeaderProps) {
  const motionProps = usePageMotion();
  return (
    <motion.div
      {...motionProps}
      className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* SectionCard                                                         */
/* ------------------------------------------------------------------ */

interface SectionCardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-hand controls: filters, links, export buttons. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Removes body padding, for tables that manage their own edges. */
  flush?: boolean;
}

/**
 * The standard content container. A subtle border carries structure and
 * shadow is reserved for interactive surfaces, per the design system.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
}: SectionCardProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card shadow-elevation-sm",
        "overflow-hidden",
        className,
      )}
    >
      {(title || actions) && (
        <header
          className={cn(
            "flex items-start justify-between gap-3 px-4 py-3",
            "border-b border-border/70",
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            )}
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actions}
            </div>
          )}
        </header>
      )}
      <div className={cn(!flush && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* StatCard                                                            */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  /** Supporting line under the value — context, not decoration. */
  hint?: string;
  /** Only pass when a real comparison exists; never fabricate a trend. */
  trend?: { direction: "up" | "down" | "flat"; label: string };
  tone?: StatusTone;
  onClick?: () => void;
  index?: number;
  className?: string;
}

const TONE_ICON: Record<StatusTone, string> = {
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg",
  info: "bg-info-bg text-info-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
  brand: "bg-primary/10 text-primary",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  trend,
  tone = "brand",
  onClick,
  index = 0,
  className,
}: StatCardProps) {
  const listMotion = useListMotion(index);
  const hover = useHoverLift();
  const interactive = Boolean(onClick);

  const trendTone: StatusTone =
    trend?.direction === "up"
      ? "success"
      : trend?.direction === "down"
        ? "danger"
        : "neutral";

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className={cn("p-1.5 rounded-lg flex-shrink-0", TONE_ICON[tone])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="text-2xl font-bold text-foreground mt-1.5 tracking-tight tabular-nums">
        {value}
      </p>
      {trend ? (
        <StatusBadge tone={trendTone} className="mt-1.5">
          {trend.direction === "up"
            ? "▲"
            : trend.direction === "down"
              ? "▼"
              : "—"}{" "}
          {trend.label}
        </StatusBadge>
      ) : hint ? (
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      ) : null}
    </>
  );

  const shared = cn(
    "rounded-2xl border border-border bg-card p-3.5 text-left w-full",
    "shadow-elevation-sm transition-shadow",
    interactive && "hover:shadow-elevation-md cursor-pointer",
    className,
  );

  return (
    <motion.div {...listMotion} {...(interactive ? hover : {})}>
      {interactive ? (
        <button type="button" onClick={onClick} className={shared}>
          {body}
        </button>
      ) : (
        <div className={shared}>{body}</div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* ActionCard                                                          */
/* ------------------------------------------------------------------ */

interface ActionCardProps {
  label: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
  tone?: StatusTone;
  index?: number;
}

/**
 * Interactive shortcut tile. Rendered as a real <button> so it is keyboard
 * operable and announces correctly, with visible hover/press/focus states.
 */
export function ActionCard({
  label,
  description,
  icon: Icon,
  onClick,
  tone = "brand",
  index = 0,
}: ActionCardProps) {
  const listMotion = useListMotion(index);
  const hover = useHoverLift();

  return (
    <motion.div {...listMotion} {...hover}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group w-full text-left rounded-xl border border-border bg-card p-3",
          "shadow-elevation-sm hover:shadow-elevation-md hover:border-primary/30",
          "active:scale-[0.99] transition-all",
          "flex items-start gap-3",
        )}
      >
        <span className={cn("p-2 rounded-lg flex-shrink-0", TONE_ICON[tone])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {label}
          </span>
          <span className="block text-xs text-muted-foreground mt-0.5">
            {description}
          </span>
        </span>
        <ArrowRight
          className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </button>
    </motion.div>
  );
}
