import type { Transition, Variants } from "motion/react";

export const MOTION_EASE = [0.22, 1, 0.36, 1] as const;
export const EXIT_EASE = [0.4, 0, 1, 1] as const;

export const motionDuration = {
  press: 0.1,
  micro: 0.16,
  panel: 0.3,
  narrative: 0.55,
} as const;

export const panelTransition: Transition = {
  duration: motionDuration.panel,
  ease: MOTION_EASE,
};

export const geometricEnter: Variants = {
  hidden: { opacity: 0, y: 8, clipPath: "inset(0 0 18% 0)" },
  visible: {
    opacity: 1,
    y: 0,
    clipPath: "inset(0 0 0% 0)",
    transition: panelTransition,
  },
  exit: {
    opacity: 0,
    y: -4,
    clipPath: "inset(0 0 12% 0)",
    transition: { duration: motionDuration.micro, ease: EXIT_EASE },
  },
};

export const staggerChildren: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.035 } },
};

export const reducedFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.12 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};