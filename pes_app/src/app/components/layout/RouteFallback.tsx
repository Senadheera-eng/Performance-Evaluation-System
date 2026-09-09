/**
 * Shown while a page's chunk is on its way.
 *
 * Deliberately plain. A page split into its own file usually arrives within a
 * frame or two on a warm connection, so this exists to hold the layout and
 * announce the wait to a screen reader rather than to be looked at.
 */
export function RouteFallback() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      <span
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary"
      />
    </div>
  );
}
