import { useReducedMotion } from "framer-motion";

/**
 * Shared motion presets.
 *
 * CSS transitions are neutralised by the prefers-reduced-motion block in
 * theme.css, but framer-motion drives animation in JS and ignores CSS
 * variables — so every animated component pulls its variants from here,
 * where the hook collapses them to a plain fade (or nothing) on request.
 */
export const DURATION = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const;

export const EASE = [0.4, 0, 0.2, 1] as const;

export function usePageMotion() {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0 : DURATION.base, ease: EASE },
  };
}

/** Staggered entry for lists and card grids. */
export function useListMotion(index: number) {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: reduce ? 0 : DURATION.base,
      ease: EASE,
      delay: reduce ? 0 : Math.min(index * 0.035, 0.25),
    },
  };
}

/** Hover lift for interactive cards; disabled when motion is reduced. */
export function useHoverLift() {
  const reduce = useReducedMotion();
  return reduce
    ? {}
    : { whileHover: { y: -3 }, transition: { duration: DURATION.fast } };
}

/** Chart animation duration in ms, as Recharts expects. */
export function useChartMotion(): number {
  const reduce = useReducedMotion();
  return reduce ? 0 : 450;
}
