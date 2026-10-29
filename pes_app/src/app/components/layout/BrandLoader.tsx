import { cn } from "../ui/utils";

/**
 * The university crest with a ring turning round it: the one loading screen
 * the app has.
 *
 * Full screen it is drawn exactly as the static one in index.html, which
 * shows before any code has arrived, so the hand-over from one to the other
 * does not jump. Inside the app it is the same crest, centred in the space
 * below the header. The image is the same file (/logo-160.png), already
 * cached by then.
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
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-5",
        // In the app: the window less the header (3.5rem) and the page's
        // padding, so the crest sits in the middle of what is visible.
        fullScreen ? "min-h-screen bg-background" : "min-h-[calc(100dvh-6.5rem)]",
      )}
      role="status"
      aria-live="polite"
    >
      <div className="relative h-20 w-20">
        <img src="/logo-160.png" alt="" width={80} height={80} className="block h-20 w-20" />
        <span
          aria-hidden="true"
          className="absolute -inset-2 animate-spin rounded-full border-2 border-primary/15 border-t-primary [animation-duration:0.9s]"
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
