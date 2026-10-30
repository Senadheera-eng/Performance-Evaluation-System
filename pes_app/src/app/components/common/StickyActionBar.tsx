import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "../ui/utils";
import { SPRING } from "./motion";

/**
 * Unsaved changes, and what to do with them, in a bar that rises from the
 * bottom of the page while there is something to save and leaves when there
 * isn't. It sits over the page's own column, beside the sidebar, never over
 * it. Buttons are right-aligned on a wide screen and full width on a phone.
 */
export function StickyActionBar({
  open,
  summary,
  children,
  className,
}: {
  open: boolean;
  /** What is waiting: "Removing CO4352 · 15 credits". */
  summary: React.ReactNode;
  /** The actions: Discard, Save. */
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="region"
          aria-label="Unsaved changes"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={reduce ? { duration: 0 } : SPRING}
          className={cn(
            "fixed bottom-4 left-4 right-4 z-40 lg:right-6 lg:left-[calc(var(--shell-offset,0px)+1.5rem)]",
            "rounded-card border border-border bg-card/95 backdrop-blur shadow-elevation-lg",
            "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center",
            className,
          )}
        >
          <div className="min-w-0 flex-1 text-sm text-foreground">{summary}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
