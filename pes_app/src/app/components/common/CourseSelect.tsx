import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../ui/utils";
import { departmentByCourseCode } from "../../../lib/departments";
import { DepartmentDot } from "./DepartmentBadge";

/** Radix reserves "" for "nothing chosen", so "none" travels as this. */
const NONE = "__none__";

export interface CourseSelectOption {
  value: string;
  code: string;
  /** What follows the code: the title, a batch, a semester. */
  detail?: string;
}

/**
 * A course dropdown in which every course carries its department's colour:
 * the dot, the code in the department's hue, and the option tinted while
 * highlighted. The same cue a course row carries everywhere else.
 *
 * A drop-in for a native <select>: `value` and `onChange` speak the same
 * strings, with `noneLabel` offering "" (e.g. "Not course-specific").
 */
export function CourseSelect({
  value,
  onChange,
  options,
  noneLabel,
  placeholder = "Choose a course...",
  ariaLabel = "Course",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: CourseSelectOption[];
  noneLabel?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const isNone = noneLabel !== undefined && value === "";
  return (
    <Select
      value={isNone ? NONE : value || undefined}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-9 w-full rounded-xl border-border bg-card text-foreground dark:bg-card dark:hover:bg-muted/50",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="rounded-xl">
        {noneLabel !== undefined && (
          <SelectItem value={NONE} className="rounded-lg text-muted-foreground">
            {noneLabel}
          </SelectItem>
        )}
        {options.map((o) => {
          const dept = departmentByCourseCode(o.code);
          return (
            <SelectItem
              key={o.value}
              value={o.value}
              className={cn("rounded-lg", dept?.optionClass)}
            >
              {dept && <DepartmentDot dept={dept} className="h-2.5 w-2.5" />}
              <span className={cn("font-semibold tabular-nums", dept?.textClass)}>
                {o.code}
              </span>
              {o.detail && <span className="truncate">{o.detail}</span>}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
