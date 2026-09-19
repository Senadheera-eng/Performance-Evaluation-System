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
