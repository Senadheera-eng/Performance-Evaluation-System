import { useReducedMotion, type Transition, type Variants } from "framer-motion";

/**
 * Shared motion presets.
 *
 * CSS transitions are neutralised by the prefers-reduced-motion block in
 * theme.css, but framer-motion drives animation in JS and ignores CSS
 * variables — so every animated component pulls its variants from here,
 * where the hook collapses them to a plain fade (or nothing) on request.
 * <MotionConfig reducedMotion="user"> at the app root does the same for
 * transforms anywhere a component forgets to.
 *
 * The house style comes from what already felt right: the tab indicator's
 * spring, the chart's fade-and-lift, and quick eased fades everywhere else.
 * Quick enough never to hold up reading; variants live at module scope so an
 * animated wrapper never re-renders its children to animate them.
 */
export const DURATION = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const;

export const EASE = [0.4, 0, 0.2, 1] as const;

/** The tab indicator's spring: the reference for anything that slides. */
export const SPRING: Transition = { type: "spring", bounce: 0.15, duration: 0.4 };

/** A page or a block of it arriving. */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
};

/** A container whose children reveal one after another. */
export function stagger(step = 0.04, delay = 0.03): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: step, delayChildren: delay } },
  };
}

/** A card in a staggered grid: a small lift and settle. */
export const cardReveal: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: EASE } },
};

/** A row in a list. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
};

/** A section opening or closing: height first, the content fading in after. */
export const sectionExpand: Variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: { height: { duration: DURATION.base, ease: EASE }, opacity: { duration: DURATION.fast } },
  },
  open: {
    height: "auto",
    opacity: 1,
    transition: {
      height: { duration: DURATION.base, ease: EASE },
      opacity: { duration: 0.2, delay: 0.05 },
    },
  },
};

/** Content swapping under a set of tabs or filters. */
export const tabContent = {
  initial: { opacity: 0, x: 8 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -8 },
  transition: { duration: DURATION.fast, ease: EASE },
} as const;

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
    : {
        whileHover: { y: -3 },
        whileTap: { scale: 0.99 },
        transition: { duration: DURATION.fast },
      };
}

/** Chart animation duration in ms, as Recharts expects. */
export function useChartMotion(): number {
  const reduce = useReducedMotion();
  return reduce ? 0 : 450;
}

/** Variants for a section that opens and closes; instant when reduced. */
export function useExpandMotion(): Variants {
  const reduce = useReducedMotion();
  return reduce
    ? {
        collapsed: { height: 0, opacity: 0, transition: { duration: 0 } },
        open: { height: "auto", opacity: 1, transition: { duration: 0 } },
      }
    : sectionExpand;
}
