import type { LucideIcon } from "lucide-react";
import { cn } from "../ui/utils";

export type StatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "brand";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-bg text-success-fg border-success-border",
  warning: "bg-warning-bg text-warning-fg border-warning-border",
  danger: "bg-danger-bg text-danger-fg border-danger-border",
  info: "bg-info-bg text-info-fg border-info-border",
  neutral: "bg-neutral-bg text-neutral-fg border-neutral-border",
  brand: "bg-primary/10 text-primary border-primary/20",
};

interface StatusBadgeProps {
  children: React.ReactNode;
  tone?: StatusTone;
  icon?: LucideIcon;
  className?: string;
  /** Renders a leading dot so status is not conveyed by colour alone. */
  dot?: boolean;
}

/**
 * Status pill built on semantic tokens rather than literal Tailwind colours,
 * so it stays legible in both themes. Always pairs colour with a text label
 * (and optionally an icon or dot) to satisfy the "not colour alone" rule.
 */
export function StatusBadge({
  children,
  tone = "neutral",
  icon: Icon,
  className,
  dot = false,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        "text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
        />
      )}
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * The tone a grade is shown in: A range success, B info, C and D a
 * warning, F and R danger, anything else (L, pending) neutral. One rule for
 * every page that shows a grade, so an A is never red on one of them.
 */
export function gradeTone(grade: string | null | undefined): StatusTone {
  if (!grade) return "neutral";
  const g = grade.toUpperCase();
  if (g.startsWith("A")) return "success";
  if (g.startsWith("B")) return "info";
  if (g.startsWith("C") || g.startsWith("D")) return "warning";
  if (g === "F" || g === "R") return "danger";
  return "neutral";
}
