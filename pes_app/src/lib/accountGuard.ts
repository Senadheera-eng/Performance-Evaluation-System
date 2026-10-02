/**
 * Signing a person out the moment their account is deactivated.
 *
 * Deactivation bars the sign-in and the database stops honouring the
 * account's admin and lecturer rights at once. A browser that is already
 * signed in still holds a login token, though, so the app asks the database
 * whether the account is still allowed in -- on sign-in, whenever the tab
 * comes back into view, and every few minutes -- and signs out if not.
 */
import { supabase } from "./supabase";

const KEY = "pes.signout_reason";

export const DEACTIVATED_MESSAGE =
  "Your PES account has been deactivated, so you have been signed out. Contact the faculty office if you think this is a mistake.";

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
