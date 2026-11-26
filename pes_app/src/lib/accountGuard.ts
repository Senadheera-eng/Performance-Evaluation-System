/**
 * Signing a person out the moment their account is deactivated, or their
 * role changes.
 *
 * Deactivation bars the sign-in and the database stops honouring the
 * account's admin and lecturer rights at once. A browser that is already
 * signed in still holds a login token, though, so the app asks the database
 * whether the account is still allowed in -- on sign-in, whenever the tab
 * comes back into view, and every few minutes -- and signs out if not. The
 * same check notices a role the Super Admin has changed since the page
 * loaded, which needs a fresh sign-in to reach the new pages.
 */
import { supabase } from "./supabase";

const KEY = "pes.signout_reason";

export const DEACTIVATED_MESSAGE =
  "Your PES account has been deactivated, so you have been signed out. Contact the faculty office if you think this is a mistake.";

export const ROLE_CHANGED_MESSAGE =
  "Your role in PES has changed, so you have been signed out. Sign in again to open your new pages.";

/** Who the database says the signed-in person is: get_my_role() and get_my_department(). */
export interface Access {
  /** "super_admin", "dept_admin" or "student"; "" for a lecturer. */
  role: string;
  department: string | null;
}

/**
 * What my_access() should say for the profile this browser loaded. A role
 * changed by the Super Admin since then (Users > Change role) no longer
 * matches it, and neither does a student moved to another department.
 */
export function expectedAccess(profile: { role: string; department: string | null } | null): Access | null {
  if (!profile) return null;
  if (profile.role === "super_admin" || profile.role === "dept_admin") {
    return { role: profile.role, department: profile.department ?? null };
  }
  // get_my_role() answers "" for a lecturer, and get_my_department() has
  // nothing for them either: their department is on the lecturer record.
  if (profile.role === "lecturer") return { role: "", department: null };
  return { role: "student", department: profile.department ?? null };
}

export type AccessChange = "none" | "role" | "department";

/** A new role means new pages, so a sign-out; a new department only a fresh profile. */
export function compareAccess(expected: Access | null, actual: Access | null): AccessChange {
  if (!expected || !actual) return "none";
  if (expected.role !== actual.role) return "role";
  if ((expected.department ?? null) !== (actual.department ?? null)) return "department";
  return "none";
}

/** The database's answer, or null when it cannot be asked (offline). */
export async function currentAccess(): Promise<Access | null> {
  const { data, error } = await supabase.rpc("my_access");
  if (error || !data) return null;
  return { role: String(data.role ?? ""), department: data.department ?? null };
}

/** Is the signed-in account still allowed in? Unknown (offline) counts as yes. */
export async function accountStillActive(): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_account_active");
  return error ? true : data !== false;
}

export function rememberSignOutReason(reason: string) {
  try {
    sessionStorage.setItem(KEY, reason);
  } catch {
    /* private mode: the sign-in page just won't say why */
  }
}

/** The reason left by the last forced sign-out, once. */
export function takeSignOutReason(): string | null {
  try {
    const reason = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return reason;
  } catch {
    return null;
  }
}
