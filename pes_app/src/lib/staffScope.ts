import type { StaffContext } from "./types";

/**
 * What a signed-in lecturer is allowed to do.
 *
 * HOD is not a role, it is an appointment: `hodDepartment` being set is the
 * only thing that separates a head of department from any other lecturer.
 * That is why there is one StaffLayout rather than a Lecturer layout and an
 * HOD layout — the navigation grows, the identity does not change.
 *
 * These are presentation gates only. Every rule here is independently
 * enforced by RLS and by the SECURITY DEFINER functions the pages call, so a
 * lecturer who edits the client cannot reach anything this hides.
 */
export interface StaffCapabilities {
  /** Sees their own assigned offerings, roster, attendance and marks. */
  teaches: boolean;
  /** Heads a department: assigns lecturers, sees department-wide analytics. */
  isHod: boolean;
  /** The department they head, or null. */
  hodDepartment: string | null;
}

export function getStaffCapabilities(
  staff: StaffContext | null,
): StaffCapabilities {
  return {
    teaches: staff !== null,
    isHod: Boolean(staff?.hodDepartment),
    hodDepartment: staff?.hodDepartment ?? null,
  };
}

/** Sidebar subtitle: the appointment if there is one, else the department. */
export function describeStaffScope(staff: StaffContext | null): string {
  if (!staff) return "—";
  if (staff.hodDepartment) return `Head — ${staff.hodDepartment}`;
  return staff.department;
}
