import { cn } from "../ui/utils";
import { departmentByName } from "../../../lib/departments";
import { DepartmentDot } from "./DepartmentBadge";

/**
 * One department at a time, from a row of chips: "All departments" and then
 * each department with its dot and a count. The chosen chip fills with the
 * department's tint and border. Scrolls sideways on a phone rather than
 * wrapping into a block above the list.
 *
 * `value` is a department name as stored, or null for all. A name that is
 * not a department (e.g. "No department yet") still gets a chip, neutral.
 */
export function DepartmentChips({
  items,
  value,
  onChange,
  total,
  ariaLabel = "Show one department",
}: {
  items: { name: string; count: number }[];
  value: string | null;
  onChange: (value: string | null) => void;
  total: number;
  ariaLabel?: string;
}) {
  const chip =
    "inline-flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors";
  return (
    <div
      className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={cn(
          chip,
          value === null
            ? "border-foreground/20 bg-foreground text-background"
            : "border-border bg-card text-muted-foreground hover:bg-muted",
        )}
      >
        All departments
        <span className="tabular-nums opacity-70">{total}</span>
      </button>
      {items.map(({ name, count }) => {
        const dept = departmentByName(name);
        const active = value === name;
        return (
          <button
            key={name}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : name)}
            className={cn(
              chip,
              active
                ? dept
                  ? cn(dept.chipClass, dept.borderClass)
                  : "border-foreground/30 bg-muted text-foreground"
                : cn("border-border bg-card text-foreground", dept?.hoverClass ?? "hover:bg-muted"),
            )}
          >
            {dept ? (
              <DepartmentDot dept={dept} className="h-2.5 w-2.5" />
            ) : (
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />
            )}
            {name}
            <span className="tabular-nums text-muted-foreground">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
