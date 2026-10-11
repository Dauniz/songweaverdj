import type { Transition, Variants } from "motion/react";

export const MOTION_EASE = [0.22, 1, 0.36, 1] as const;
export const EXIT_EASE = [0.4, 0, 1, 1] as const;

export const motionDuration = {
  press: 0.1,
  micro: 0.16,
  panel: 0.3,
  narrative: 0.55,
} as const;

export const motionTransition = {
  press: { duration: motionDuration.press, ease: MOTION_EASE },
  micro: { duration: motionDuration.micro, ease: MOTION_EASE },
  panel: { duration: motionDuration.panel, ease: MOTION_EASE },
  narrative: { duration: motionDuration.narrative, ease: MOTION_EASE },
} satisfies Record<string, Transition>;

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

export const stateSwap: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 3 },
  visible: { opacity: 1, scale: 1, y: 0, transition: motionTransition.micro },
  exit: { opacity: 0, scale: 0.97, y: -2, transition: { duration: 0.1, ease: EXIT_EASE } },
};

export const directionalPanel = (direction: -1 | 1): Variants => ({
  hidden: { opacity: 0, x: direction * 14, clipPath: direction < 0 ? "inset(0 4% 0 0)" : "inset(0 0 0 4%)" },
  visible: { opacity: 1, x: 0, clipPath: "inset(0)", transition: motionTransition.panel },
  exit: { opacity: 0, x: direction * -8, transition: { duration: motionDuration.micro, ease: EXIT_EASE } },
});