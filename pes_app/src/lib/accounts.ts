/**
 * Accounts: invitations, password resets and deactivation, through the
 * `account` edge function (supabase/functions/account). The links it emails
 * carry a single-use, time-limited token after "#", read by the
 * /account/setup and /account/reset pages.
 *
 * Changing a member of staff's role goes through the database instead
 * (admin_change_staff_role), so the whole move happens in one transaction.
 */
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type UserKind = "student" | "lecturer" | "dept_admin" | "super_admin";
export type AccountState = "active" | "invited" | "invite_expired" | "deactivated" | "no_account";

export interface ManagedUser {
  user_id: string | null;
  kind: UserKind;
  name: string;
  email: string;
  department: string | null;
  detail: {
    reg_number?: string | null;
    index_number?: string | null;
    batch_year?: number | null;
    academic_status?: string;
    lecturer_id?: string;
    staff_no?: string | null;
  };
  state: AccountState;
  last_sign_in_at: string | null;
  invited_at: string | null;
  invite_expires_at: string | null;
  deactivated_at: string | null;
  deactivation_reason: string | null;
}

export const KIND_LABEL: Record<UserKind, string> = {
  student: "Student",
  lecturer: "Lecturer",
  dept_admin: "Department Admin",
  super_admin: "Super Admin",
};

/** Calls the account function and returns its answer or its own error message. */
export async function accountCall<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke<T>("account", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null);
      if (detail?.error) return { data: null, error: String(detail.error) };
    }
    return { data: null, error: "PES could not be reached. Check your connection and try again." };
  }
  return { data: data ?? null, error: null };
}

export interface InviteResult {
  ok: true;
  user_id?: string;
  email: string;
  emailed: boolean;
  invite_link?: string;
  email_error?: string;
  expires_in_hours: number;
}

export const STUDENT_DEPARTMENTS = [
  "Civil Engineering",
  "Computer Engineering",
  "Electrical and Electronic Engineering",
  "Mechanical Engineering",
] as const;
/** Staff can also belong to Interdisciplinary Studies, which has no students of its own. */
export const STAFF_DEPARTMENTS = [...STUDENT_DEPARTMENTS, "Interdisciplinary Studies"] as const;

/* ------------------------------------------------------------------ */
/* Changing a member of staff's role (admin_change_staff_role)          */
/* ------------------------------------------------------------------ */

export type StaffRole = Exclude<UserKind, "student">;

export const STAFF_ROLES: StaffRole[] = ["lecturer", "dept_admin", "super_admin"];

/** What the Super Admin sees before changing someone's role. */
export interface StaffRolePreview {
  name: string;
  role: StaffRole;
  department: string | null;
  is_self: boolean;
  deactivated: boolean;
  /** Set when they are a lecturer who heads a department. */
  hod_department: string | null;
  active_mentees: number;
  current_courses: number;
  other_super_admins: number;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function getStaffRolePreview(userId: string): Promise<Result<StaffRolePreview>> {
  const { data, error } = await supabase.rpc("admin_staff_role_preview", { p_user: userId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as StaffRolePreview };
}

export async function changeStaffRole(
  userId: string,
  role: StaffRole,
  department: string | null,
  reason: string | null,
): Promise<Result<{ message: string }>> {
  const { data, error } = await supabase.rpc("admin_change_staff_role", {
    p_user: userId,
    p_role: role,
    p_department: role === "super_admin" ? null : department,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { message: String(data?.message ?? "The role was changed.") } };
}

/**
 * Why a role change cannot go ahead yet, if it cannot: the same rules the
 * database applies, said before the Super Admin fills in the form.
 */
export function roleChangeBlocker(preview: StaffRolePreview, to: StaffRole): string | null {
  if (preview.is_self) return "You cannot change your own role. Another Super Admin can.";
  if (preview.deactivated) return "This account is deactivated. Reactivate it first.";
  if (preview.role === "lecturer" && to !== "lecturer") {
    if (preview.hod_department) {
      return `${preview.name} is Head of ${preview.hod_department}. Appoint another head on Heads of Department first.`;
    }
    if (preview.active_mentees > 0) {
      return `${preview.name} mentors ${preview.active_mentees} student${preview.active_mentees === 1 ? "" : "s"}. The Head of ${preview.department ?? "their department"} moves them to another mentor first.`;
    }
  }
  if (preview.role === "super_admin" && to !== "super_admin" && preview.other_super_admins < 1) {
    return "PES needs at least one Super Admin.";
  }
  return null;
}

/** The password rules the account function enforces, checked as the person types. */
export function passwordIssues(password: string, email: string | null): string[] {
  const issues: string[] = [];
  if (password.length < 8) issues.push("At least 8 characters");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) issues.push("Letters and numbers");
  const local = email?.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) {
    issues.push("Not your email or registration number");
  }
  return issues;
}
