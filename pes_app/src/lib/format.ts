/**
 * Registration numbers are stored as bare digits (e.g. "108953") but are
 * displayed faculty-wide with the EN prefix (e.g. "EN108953"). Tolerates
 * values that already carry the prefix so it can never double up.
 */
export function formatRegNumber(
  regNumber: string | null | undefined,
): string {
  if (!regNumber) return "—";
  return regNumber.toUpperCase().startsWith("EN")
    ? regNumber.toUpperCase()
    : `EN${regNumber}`;
}

/** "21 Sept 2026, 8:20 am": a window's opening or closing time, without the
 *  seconds and in the day-month order the rest of the system uses. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
