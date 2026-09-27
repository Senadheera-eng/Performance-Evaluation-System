import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../ui/utils";
import { departmentByName } from "../../../lib/departments";
import { DepartmentDot } from "./DepartmentBadge";

/** Radix reserves "" for "nothing chosen", so "all" travels as this instead. */
const ALL = "__all__";

/**
 * A department dropdown in which every department carries its Handbook
 * colour: a dot beside each name, and the option tinted in its hue while
 * highlighted or chosen. The trigger keeps the dot, so the choice reads at a
 * glance once the list is closed.
 *
 * A drop-in for the native <select> the pages used: `value` and `onChange`
 * speak the same strings, including whatever the page uses for "all"
 * (`allValue`, "" by default).
 */
export function DepartmentSelect({
  value,
  onChange,
  departments,
  allLabel,
  allValue = "",
  ariaLabel = "Department",
  size = "default",
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  departments: readonly string[];
  /** Offer an "all departments" option with this label. */
  allLabel?: string;
  /** The value the page uses for "all". */
  allValue?: string;
  ariaLabel?: string;
  size?: "sm" | "default" | "lg";
  disabled?: boolean;
  className?: string;
}) {
  const isAll = allLabel !== undefined && value === allValue;
  return (
    <Select
      value={isAll ? ALL : value}
      onValueChange={(v) => onChange(v === ALL ? allValue : v)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "w-full rounded-xl border-border bg-card text-foreground dark:bg-card dark:hover:bg-muted/50",
          size === "lg" ? "h-10" : size === "sm" ? "h-8" : "h-9",
          className,
        )}
      >
        <SelectValue placeholder="Choose a department" />
      </SelectTrigger>
      <SelectContent className="rounded-xl">
        {allLabel !== undefined && (
          <SelectItem value={ALL} className="rounded-lg">
            <Building2 className="text-muted-foreground" aria-hidden="true" />
            {allLabel}
          </SelectItem>
        )}
        {departments.map((name) => {
          const dept = departmentByName(name);
          return (
            <SelectItem
              key={name}
              value={name}
              className={cn("rounded-lg", dept?.optionClass)}
            >
              {dept ? (
                <DepartmentDot dept={dept} className="h-2.5 w-2.5" />
              ) : (
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />
              )}
              {name}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
