const KEY = "pes.device";

/**
 * A stable, meaningless id for this browser.
 *
 * It exists for one rule: within a lecture, one device may sign in one
 * student. That is what stops a phone being passed along a row of absent
 * friends. Clearing site data earns a new id, so this is a cost, not a wall —
 * but the cost has to be paid again for every name, which is the point.
 *
 * Deliberately not a fingerprint. Nothing is read from the device, so the id
 * identifies a browser profile and says nothing about the person holding it.
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Private mode with storage blocked: the check-in still works, it just
    // carries no device, and the one-per-device rule cannot apply to it.
    return "";
  }
}
