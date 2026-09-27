import type { Student } from "./types";

/**
 * An admin's data scope, derived from their student profile. This mirrors
 * (but never replaces) the RLS policies enforced server-side — it exists
 * purely to scope what the admin UI *shows* (e.g. course dropdowns), since
 * the courses table itself stays broadly SELECT-able by RLS design (every
 * student needs to browse the full catalogue to enroll in electives).
 * Every other admin-facing table (students, results, attendance,
 * enrollments, medical_submissions) is fully scoped by RLS on its own —
 * no client-side filter is needed or attempted for those.
 */
export type AdminScope =
  | { kind: "all" }
  | { kind: "department"; department: string };

export function getAdminScope(student: Student | null): AdminScope {
  if (student?.role === "super_admin") return { kind: "all" };
  return { kind: "department", department: student?.department ?? "" };
}

/** Human-readable label for admin headers/subtitles. */
/**
 * What an admin looks after, for a sentence on a page: "the whole faculty"
 * for the super admin, "the Computer Engineering Department" otherwise.
 * describeAdminScope is the label for the sidebar; this reads as prose.
 */
export function describeAdminReach(student: Student | null): string {
  if (student?.role === "super_admin") return "the whole faculty";
  return student?.department ? `the ${student.department} Department` : "your department";
}

export function describeAdminScope(student: Student | null): string {
  if (student?.role === "super_admin") return "Super Admin — All Departments";
  return student?.department ? `${student.department} Department` : "—";
}
