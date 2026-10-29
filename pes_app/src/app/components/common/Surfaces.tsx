import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../ui/utils";
import { AnimatedBar, AnimatedNumber } from "./Animated";
import {
  DURATION,
  EASE,
  cardReveal,
  useExpandMotion,
  useHoverLift,
  useListMotion,
  usePageMotion,
} from "./motion";
import { StatusBadge, type StatusTone } from "./StatusBadge";

/* ------------------------------------------------------------------ */
/* PageHeader                                                          */
/* ------------------------------------------------------------------ */

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary action(s) for this page, right-aligned on desktop. */
  actions?: React.ReactNode;
  /** Contextual line above the title, e.g. a scope or breadcrumb. */
  eyebrow?: React.ReactNode;
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
      className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3"
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* HeroCard                                                            */
/* ------------------------------------------------------------------ */

/** A button on the brand gradient: white, with the hero's own red as text. */
export const heroButtonClass =
  "bg-white text-[var(--hero-to)] hover:bg-white/90 shadow-elevation-sm";
/** A quieter button on the brand gradient. */
export const heroGhostButtonClass =
  "bg-white/12 text-white hover:bg-white/20 border border-white/25";

interface HeroCardProps {
  /** What the number is, above it: "Current CGPA". */
  eyebrow: React.ReactNode;
  /** The number that matters, large. Use AnimatedNumber for a count-up. */
  value: React.ReactNode;
  /** What the number means, beside or under it: the class it puts you in. */
  label?: React.ReactNode;
  /** A supporting line under the value. */
  meta?: React.ReactNode;
  progress?: { value: number; max: number; label: string; caption?: React.ReactNode; marker?: number };
  actions?: React.ReactNode;
  /** The right-hand side on wide screens: a ring, a sparkline, a list. */
  aside?: React.ReactNode;
  /** A strip of small facts along the bottom. */
  footer?: React.ReactNode;
  /** brand: the crimson gradient, white text. tint: a soft brand wash. */
  variant?: "brand" | "tint";
  className?: string;
}

/**
 * The one card at the top of a page that carries what the student came for:
 * their CGPA, their overall attendance, the SGPA their class needs. One per
 * page; everything else on the page is secondary to it.
 */
export function HeroCard({
  eyebrow,
  value,
  label,
  meta,
  progress,
  actions,
  aside,
  footer,
  variant = "brand",
  className,
}: HeroCardProps) {
  const reduce = useReducedMotion();
  const brand = variant === "brand";
  return (
    <motion.section
      variants={cardReveal}
      initial={reduce ? false : "hidden"}
      animate="show"
      className={cn(
        // A column, so a hero stretched beside a taller card keeps its
        // footer at the bottom instead of a gap under it.
        "relative flex flex-col overflow-hidden rounded-card p-5 sm:p-6",
        brand
          ? "surface-hero shadow-elevation-md"
          : "surface-tint border border-primary/15 shadow-elevation-sm",
        className,
      )}
    >
      <div className={cn("grid gap-5", aside && "lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center")}>
        <div className="min-w-0">
          <p
            className={cn(
              "text-xs font-semibold uppercase tracking-wide",
              brand ? "text-[var(--hero-muted)]" : "text-muted-foreground",
            )}
          >
            {eyebrow}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={cn(
                "text-5xl font-bold tracking-tight tabular-nums leading-none",
                brand ? "text-white" : "text-foreground",
              )}
            >
              {value}
            </span>
            {label && (
              <span className={cn("text-base font-semibold", brand ? "text-white" : "text-foreground")}>
                {label}
              </span>
            )}
          </div>
          {meta && (
            <p className={cn("mt-2 text-sm", brand ? "text-[var(--hero-muted)]" : "text-muted-foreground")}>
              {meta}
            </p>
          )}
          {progress && (
            <div className="mt-4 max-w-md">
              <AnimatedBar
                value={progress.value}
                max={progress.max}
                label={progress.label}
                marker={progress.marker}
                tone={brand ? "hero" : "brand"}
              />
              {progress.caption && (
                <p className={cn("mt-1.5 text-xs", brand ? "text-[var(--hero-muted)]" : "text-muted-foreground")}>
                  {progress.caption}
                </p>
              )}
            </div>
          )}
          {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
        </div>
        {aside && <div className="min-w-0">{aside}</div>}
      </div>
      {footer && (
        <div className="mt-auto pt-5">
          <div className={cn("border-t pt-4", brand ? "border-white/20" : "border-border")}>{footer}</div>
        </div>
      )}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* StatStrip                                                           */
/* ------------------------------------------------------------------ */

export interface StripItem {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatusTone;
  /** Makes the chip a link to the page that explains the number. */
  onClick?: () => void;
}

const STRIP_TONE: Record<StatusTone, string> = {
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
  info: "text-info-fg",
  neutral: "text-muted-foreground",
  brand: "text-primary",
};

/**
 * Secondary numbers as a row of small chips, rather than a row of cards that
 * each claim as much attention as the number that matters.
 */
export function StatStrip({
  items,
  onHero = false,
  className,
}: {
  items: StripItem[];
  onHero?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {items.map((it) => {
        const chip = cn(
          // A pill on one line; a long label that wraps on a phone keeps
          // soft corners instead of a lozenge.
          "inline-flex items-center gap-1.5 rounded-[0.9rem] px-3 py-1 text-left text-xs transition-colors",
          onHero
            ? "bg-white/12 text-[var(--hero-muted)] ring-1 ring-inset ring-white/20"
            : "bg-card text-muted-foreground ring-1 ring-inset ring-border",
          it.onClick && (onHero ? "hover:bg-white/20" : "hover:bg-muted"),
        );
        const content = (
          <>
            {it.icon && (
              <it.icon
                className={cn("h-3.5 w-3.5", onHero ? "text-white" : STRIP_TONE[it.tone ?? "neutral"])}
                aria-hidden="true"
              />
            )}
            <span className={cn("font-semibold tabular-nums", onHero ? "text-white" : "text-foreground")}>
              {it.value}
            </span>
            <span>{it.label}</span>
          </>
        );
        return (
          <li key={it.label}>
            {it.onClick ? (
              <button type="button" onClick={it.onClick} className={chip}>
                {content}
              </button>
            ) : (
              <span className={chip}>{content}</span>
            )}
          </li>
        );
      })}
    </ul>
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
  /** The title opens and closes the body: for detail a student may want. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Remembers, on this device, whether the student left it open. */
  storageKey?: string;
  /** A short line shown beside the title while collapsed, e.g. a count. */
  summary?: React.ReactNode;
}

function readOpen(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const v = window.localStorage.getItem(`pes.section.${key}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

/**
 * The standard content container. A subtle border carries structure and
 * shadow is reserved for interactive surfaces, per the design system.
 * Collapsible, it keeps detail one click away rather than on the page.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
  collapsible = false,
  defaultOpen = true,
  storageKey,
  summary,
}: SectionCardProps) {
  const [open, setOpen] = useState(() => (collapsible ? readOpen(storageKey, defaultOpen) : true));
  const expand = useExpandMotion();
  const bodyId = useId();

  useEffect(() => {
    if (!collapsible || !storageKey) return;
    try {
      window.localStorage.setItem(`pes.section.${storageKey}`, open ? "1" : "0");
    } catch {
      /* Blocked storage: the section just opens as it did before. */
    }
  }, [open, collapsible, storageKey]);

  const heading = (
    <div className="min-w-0 flex-1">
      {title && (
        <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
          {title}
          {collapsible && !open && summary && (
            <span className="text-xs font-normal text-muted-foreground">{summary}</span>
          )}
        </h2>
      )}
      {description && (
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      )}
    </div>
  );

  const body = <div className={cn(!flush && "p-4 sm:p-5", bodyClassName)}>{children}</div>;

  return (
    <section
      className={cn(
        "rounded-card border border-border bg-card shadow-elevation-sm",
        "overflow-hidden",
        className,
      )}
    >
      {(title || actions) && (
        <header
          className={cn(
            // Wraps rather than squeezing: on a phone, wide actions (a set
            // of filter tabs) drop under the title instead of crushing it.
            "flex flex-wrap items-start justify-between gap-x-3 gap-y-2.5 px-4 sm:px-5 py-3.5",
            (!collapsible || open) && "border-b border-border/70",
          )}
        >
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="group -m-1 flex min-w-0 flex-1 basis-[12rem] items-start gap-2 rounded-control p-1 text-left"
            >
              <ChevronDown
                className={cn(
                  "mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200",
                  !open && "-rotate-90",
                )}
                aria-hidden="true"
              />
              {heading}
            </button>
          ) : (
            <div className="min-w-0 flex-1 basis-[12rem]">{heading}</div>
          )}
          {actions && (
            <div className="flex max-w-full items-center gap-2">
              {actions}
            </div>
          )}
        </header>
      )}
      {collapsible ? (
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={bodyId}
              key="body"
              variants={expand}
              initial="collapsed"
              animate="open"
              exit="collapsed"
              className="overflow-hidden"
            >
              {body}
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        body
      )}
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
  /** Counts up to this number instead of showing `value` as it is. */
  numeric?: { value: number; decimals?: number; suffix?: string };
  /** A thin bar under the number, e.g. credits towards 144. */
  progress?: { value: number; max: number; label: string };
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
  numeric,
  progress,
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
      <p className="text-3xl font-bold text-foreground mt-1 tracking-tight tabular-nums">
        {numeric ? (
          <AnimatedNumber value={numeric.value} decimals={numeric.decimals} suffix={numeric.suffix} />
        ) : (
          value
        )}
      </p>
      {progress && (
        <AnimatedBar
          className="mt-2"
          value={progress.value}
          max={progress.max}
          label={progress.label}
          tone={tone === "neutral" ? "brand" : tone}
        />
      )}
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
    "rounded-card border border-border bg-card p-4 text-left w-full h-full",
    "shadow-elevation-sm transition-shadow",
    interactive && "hover:shadow-elevation-md cursor-pointer",
    className,
  );

  return (
    <motion.div {...listMotion} {...(interactive ? hover : {})} className="h-full">
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
          "group w-full text-left rounded-card border border-border bg-card p-3.5",
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

/* ------------------------------------------------------------------ */
/* Reveal                                                              */
/* ------------------------------------------------------------------ */

/**
 * Wraps a block that should arrive with the page's staggered rhythm, without
 * each page re-declaring the same initial/animate pair.
 */
export function Reveal({
  children,
  index = 0,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : DURATION.base, ease: EASE, delay: reduce ? 0 : Math.min(index * 0.05, 0.3) }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
