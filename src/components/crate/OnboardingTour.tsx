import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRadio } from "./radio-context";

const SETUP_KEY = "songweaver-onboarding-setup-v1";
const FEEDBACK_KEY = "songweaver-onboarding-feedback-v1";

type TargetRect = { top: number; left: number; width: number; height: number };

type Step = {
  target: string;
  eyebrow: string;
  title: string;
  body: string;
};

const SETUP_STEPS: Step[] = [
  {
    target: "spotify-sync",
    eyebrow: "Step 1 of 3",
    title: "Bring in your music",
    body: "Sync imports your liked songs and songs from playlists you created. Crate uses this as the map for every session.",
  },
  {
    target: "session-start",
    eyebrow: "Step 2 of 3",
    title: "Start a live session",
    body: "Starting a session links Crate to what Spotify is playing. Finishes, skips, and songs you choose steer the maze.",
  },
  {
    target: "prompt",
    eyebrow: "Step 3 of 3",
    title: "Choose where to begin",
    body: "Describe a vibe, search for a song, or leave Spotify playing and let Crate continue from there.",
  },
];

const FEEDBACK_STEP: Step = {
  target: "feedbacker",
  eyebrow: "One more thing",
  title: "Teach Crate what you feel",
  body: "Feedbacker turns a few words about the current song into a Walrus taste memory. That feeling can shape future picks.",
};

function readDone(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markDone(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Private browsing can block storage; dismiss for this mount regardless.
  }
}

export function OnboardingTour({ showMemory }: { showMemory: () => void }) {
  const { sessionLive, radio } = useRadio();
  const [setupStep, setSetupStep] = useState<number | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rect, setRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (readDone(SETUP_KEY)) return;
    window.dispatchEvent(new Event("songweaver-onboarding-open-spotify"));
    const timer = window.setTimeout(() => setSetupStep(0), 550);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!sessionLive || !radio.active || !radio.current || setupStep !== null || readDone(FEEDBACK_KEY)) return;
    showMemory();
    const timer = window.setTimeout(() => setFeedbackOpen(true), 650);
    return () => window.clearTimeout(timer);
  }, [radio.active, radio.current, sessionLive, setupStep, showMemory]);

  const step = useMemo(
    () => (feedbackOpen ? FEEDBACK_STEP : setupStep === null ? null : SETUP_STEPS[setupStep]),
    [feedbackOpen, setupStep],
  );

  const locate = useCallback(() => {
    if (!step) return setRect(null);
    const target = document.querySelector<HTMLElement>(`[data-onboarding="${step.target}"]`);
    if (!target) return setRect(null);
    const next = target.getBoundingClientRect();
    setRect({ top: next.top, left: next.left, width: next.width, height: next.height });
  }, [step]);

  useEffect(() => {
    if (!step) return;
    locate();
    const timer = window.setInterval(locate, 250);
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
    };
  }, [locate, step]);

  if (!step) return null;

  const finishSetup = () => {
    markDone(SETUP_KEY);
    setSetupStep(null);
  };
  const dismissFeedback = () => {
    markDone(FEEDBACK_KEY);
    setFeedbackOpen(false);
  };
  const dismiss = feedbackOpen ? dismissFeedback : finishSetup;
  const pad = 8;
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const cardWidth = Math.min(336, vw - 32);
  const cardLeft = rect
    ? Math.max(16, Math.min(vw - cardWidth - 16, rect.left + rect.width / 2 - cardWidth / 2))
    : Math.max(16, (vw - cardWidth) / 2);
  const placeBelow = rect ? rect.top + rect.height + 190 < vh : false;
  const cardTop = rect
    ? placeBelow
      ? rect.top + rect.height + 18
      : Math.max(16, rect.top - 190)
    : Math.max(16, vh / 2 - 95);

  return (
    <div className="fixed inset-0 z-[90] pointer-events-none" aria-live="polite">
      {rect && (
        <>
          <div className="absolute inset-x-0 top-0 bg-background/75" style={{ height: Math.max(0, rect.top - pad) }} />
          <div className="absolute inset-x-0 bottom-0 bg-background/75" style={{ top: rect.top + rect.height + pad }} />
          <div className="absolute bg-background/75" style={{ top: rect.top - pad, left: 0, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2 }} />
          <div className="absolute bg-background/75" style={{ top: rect.top - pad, left: rect.left + rect.width + pad, right: 0, height: rect.height + pad * 2 }} />
          <div
            className="absolute rounded-lg border-2 border-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_18%,transparent)] transition-all duration-300"
            style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          />
        </>
      )}
      {!rect && <div className="absolute inset-0 bg-background/75" />}

      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="onboarding-title"
        className="pointer-events-auto absolute rounded-lg border bg-popover p-4 text-popover-foreground shadow-2xl transition-[top,left] duration-300"
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{step.eyebrow}</p>
            <h2 id="onboarding-title" className="mt-1 text-lg font-bold">{step.title}</h2>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={dismiss} aria-label="Skip onboarding" className="-mr-1 -mt-1 rounded-full">
            <X />
          </Button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          {feedbackOpen ? (
            <Button variant="ghost" size="sm" onClick={dismissFeedback}>Maybe later</Button>
          ) : setupStep === 0 ? (
            <Button variant="ghost" size="sm" onClick={finishSetup}>Skip</Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setSetupStep((current) => Math.max(0, (current ?? 0) - 1))}>
              <ArrowLeft /> Back
            </Button>
          )}
          {feedbackOpen ? (
            <Button
              size="sm"
              onClick={() => {
                document.querySelector<HTMLElement>('[data-onboarding="feedbacker"]')?.click();
                dismissFeedback();
              }}
            >
              Open Feedbacker <ArrowRight />
            </Button>
          ) : setupStep === SETUP_STEPS.length - 1 ? (
            <Button size="sm" onClick={finishSetup}>Got it <Check /></Button>
          ) : (
            <Button size="sm" onClick={() => setSetupStep((current) => Math.min(SETUP_STEPS.length - 1, (current ?? 0) + 1))}>
              Next <ArrowRight />
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}