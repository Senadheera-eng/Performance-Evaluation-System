import { cn } from "../ui/utils";
import {
  departmentByCourseCode,
  departmentByName,
  type Department,
} from "../../../lib/departments";

interface DepartmentBadgeProps {
  /** A department name as stored, e.g. "Computer Engineering". */
  department?: string | null;
  /** Or a course code, whose prefix names the department. */
  courseCode?: string | null;
  /** "code" shows CO; "name" shows Computer Engineering. */
  label?: "code" | "name";
  className?: string;
}

/**
 * A department chip in the Handbook colour. The text always names the
 * department, so the colour is a second cue and never the only one.
 */
export function DepartmentBadge({
  department,
  courseCode,
  label = "name",
  className,
}: DepartmentBadgeProps) {
  const dept = department
    ? departmentByName(department)
    : departmentByCourseCode(courseCode);
  if (!dept) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5",
        "text-xs font-medium whitespace-nowrap",
        dept.chipClass,
        className,
      )}
      title={dept.name}
    >
      <DepartmentDot dept={dept} />
      {label === "code" ? dept.code : dept.name}
    </span>
  );
}

/** Just the coloured dot, for dense rows where a chip would crowd. */
export function DepartmentDot({
  dept,
  className,
}: {
  dept: Department;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("h-2 w-2 flex-shrink-0 rounded-full", dept.swatchClass, className)}
    />
  );
}

/**
 * A course code in its department's hue: CO3554 in Computer Engineering's
 * amber, IS4161 in Interdisciplinary red. The code names the department, so
 * the colour is a second cue. Falls back to plain text for a code whose
 * prefix is not a department.
 */
export function CourseCode({
  code,
  className,
}: {
  code: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums whitespace-nowrap",
        departmentByCourseCode(code)?.textClass ?? "text-foreground",
        className,
      )}
    >
      {code}
    </span>
  );
}
