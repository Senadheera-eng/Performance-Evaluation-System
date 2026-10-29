import { cn } from "../ui/utils";

/**
 * The university crest with a ring turning round it: the one loading screen
 * the app has.
 *
 * Full screen it is drawn exactly as the static one in index.html, which
 * shows before any code has arrived, so the hand-over from one to the other
 * does not jump. The image is the same file (/logo-128.png), already cached
 * by then.
 */
export function BrandLoader({
  label = "Loading…",
  fullScreen = false,
  showLabel = fullScreen,
}: {
  label?: string;
  /** The whole window, as while signing in; otherwise the page's own area. */
  fullScreen?: boolean;
  /** A page loading inside the app needs no words, only the crest. */
  showLabel?: boolean;
}) {
  const size = fullScreen ? "h-16 w-16" : "h-10 w-10";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4",
        fullScreen ? "min-h-screen bg-background" : "min-h-[40vh]",
      )}
      role="status"
      aria-live="polite"
    >
      <div className={cn("relative", size)}>
        <img src="/logo-128.png" alt="" width={64} height={64} className={cn("block", size)} />
        <span
          aria-hidden="true"
          className={cn(
            "absolute animate-spin rounded-full border-2 border-primary/15 border-t-primary [animation-duration:0.9s]",
            fullScreen ? "-inset-1.5" : "-inset-1",
          )}
        />
      </div>
      {showLabel ? (
        <p className="text-sm text-muted-foreground">{label}</p>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}
