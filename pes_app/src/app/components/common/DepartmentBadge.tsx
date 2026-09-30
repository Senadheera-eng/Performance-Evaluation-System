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

/**
 * A department named inline, in running text or a meta line: its dot and its
 * name in the department's colour. Lighter than a chip, for places a chip
 * would crowd. Plain text for a name that is not a department.
 */
export function DepartmentName({
  department,
  label = "name",
  className,
}: {
  department: string | null | undefined;
  label?: "code" | "name";
  className?: string;
}) {
  const dept = departmentByName(department);
  if (!dept) return <span className={className}>{department}</span>;
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap", dept.textClass, className)}
      title={dept.name}
    >
      <DepartmentDot dept={dept} className="h-1.5 w-1.5" />
      {label === "code" ? dept.code : dept.name}
    </span>
  );
}

const CODES_IN_TEXT = /\b(?:CE|CO|EE|ME|IS)\d{4}\b/g;

/**
 * A sentence with every course code in it set in its department's colour —
 * "Attendance is open for CO4204 — Computer Vision" — and the rest left as
 * it was. For titles and messages written as plain text: notifications,
 * notices, insights, the assistant's replies.
 */
export function CodedText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CODES_IN_TEXT)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<CourseCode key={at} code={m[0]} />);
    last = at + m[0].length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
