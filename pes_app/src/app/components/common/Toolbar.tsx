import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../ui/utils";
import { DURATION, EASE } from "./motion";

/**
 * One row of controls above a list: a search, the main filter as pill tabs,
 * and everything else behind a Filters button. It wraps on narrow screens
 * rather than stacking four separate rows before the content.
 */
export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      {children}
    </div>
  );
}

/** A search box with an icon and a clear button. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Read by screen readers; the placeholder is not a label. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0 flex-1 sm:min-w-[220px]", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 rounded-control bg-card pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * Secondary filters behind one button. The count says how many are set, so
 * a filtered list never looks like a short one.
 */
export function FilterButton({
  count,
  children,
  label = "Filters",
  align = "end",
}: {
  count: number;
  children: React.ReactNode;
  label?: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 rounded-control">
          <SlidersHorizontal aria-hidden="true" />
          {label}
          {count > 0 && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(22rem,calc(100vw-2rem))] rounded-card p-4">
        <div className="space-y-4">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

export interface ActiveFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

/** The filters in force, as chips that remove themselves when tapped. */
export function ActiveFilters({
  filters,
  onClearAll,
}: {
  filters: ActiveFilter[];
  onClearAll?: () => void;
}) {
  const reduce = useReducedMotion();
  if (filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AnimatePresence initial={false}>
        {filters.map((f) => (
          <motion.button
            key={f.key}
            type="button"
            layout={!reduce}
            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            transition={{ duration: DURATION.fast, ease: EASE }}
            onClick={f.onRemove}
            aria-label={`Remove filter: ${f.label}`}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15"
          >
            {f.label}
            <X className="h-3 w-3" aria-hidden="true" />
          </motion.button>
        ))}
      </AnimatePresence>
      {onClearAll && filters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
