/**
 * Accounts: invitations, password resets and deactivation, through the
 * `account` edge function (supabase/functions/account). The links it emails
 * carry a single-use, time-limited token after "#", read by the
 * /account/setup and /account/reset pages.
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
