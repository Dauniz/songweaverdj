import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRadio } from "./radio-context";
import { supabase } from "@/integrations/supabase/client";

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
    target: "prompt",
    eyebrow: "Step 2 of 3",
    title: "Start a session from here",
    body: "Describe a vibe, search for a song, or press Start session. Once live, Crate follows Spotify: finishes, skips, and songs you pick there steer the maze.",
  },
  {
    target: "side-roads",
    eyebrow: "Step 3 of 3",
    title: "Bend the path with side roads",
    body: "The buttons under the chat are alternative roads — Deep cuts, Wormhole, Scene and Texture. Turning one on replaces the default roads (Vibe, Era, New Angle) with its own rules for what Crate plays next. Only one can be on at a time, and turning it off puts you back on the default roads. Tap the question mark for what each one does.",
  },
];

const FEEDBACK_STEP: Step = {
  target: "feedbacker",
  eyebrow: "One more thing",
  title: "Teach Crate what you feel",
  body: "Feedbacker turns a few words about the current song into a Walrus taste memory. That feeling can shape future picks.",
};

type Flags = Record<string, boolean>;

// Onboarding is shown once per account (Spotify or guest), stored on the account itself.
async function readAccountFlags(): Promise<{ userId: string; flags: Flags } | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const meta = (data.user.user_metadata ?? {}) as { onboarding?: Flags };
  return { userId: data.user.id, flags: meta.onboarding ?? {} };
}

function cacheKey(userId: string, key: string) {
  return `${key}:${userId}`;
}

function readCached(userId: string | null, key: string) {
  if (!userId) return true;
  try {
    return window.localStorage.getItem(cacheKey(userId, key)) === "1";
  } catch {
    return false;
  }
}

function markDone(userId: string | null, key: string) {
  if (!userId) return;
  try {
    window.localStorage.setItem(cacheKey(userId, key), "1");
  } catch {
    // Storage can be blocked; the account flag below still records it.
  }
  void (async () => {
    const current = await readAccountFlags();
    await supabase.auth.updateUser({ data: { onboarding: { ...(current?.flags ?? {}), [key]: true } } });
  })();
}

export function OnboardingTour({ showMemory }: { showMemory: () => void }) {
  const { sessionLive, radio } = useRadio();
  const [setupStep, setSetupStep] = useState<number | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [flags, setFlags] = useState<Flags | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readAccountFlags().then((res) => {
      if (cancelled || !res) return;
      setUserId(res.userId);
      setFlags(res.flags);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isDone = (key: string) => !flags || !!flags[key] || readCached(userId, key);

  useEffect(() => {
    if (!flags || isDone(SETUP_KEY)) return;
    window.dispatchEvent(new Event("songweaver-onboarding-open-spotify"));
    const timer = window.setTimeout(() => setSetupStep(0), 550);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags]);

  useEffect(() => {
    if (!sessionLive || !radio.active || !radio.current || setupStep !== null || isDone(FEEDBACK_KEY)) return;
    showMemory();
    const timer = window.setTimeout(() => setFeedbackOpen(true), 650);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radio.active, radio.current, sessionLive, setupStep, showMemory, flags]);

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

  const finishSetup = () => {
    markDone(userId, SETUP_KEY);
    setFlags((f) => ({ ...(f ?? {}), [SETUP_KEY]: true }));
    setSetupStep(null);
    window.dispatchEvent(new Event("songweaver-onboarding-done"));
  };
  const dismissFeedback = () => {
    markDone(userId, FEEDBACK_KEY);
    setFlags((f) => ({ ...(f ?? {}), [FEEDBACK_KEY]: true }));
    setFeedbackOpen(false);
  };
  useEffect(() => {
    if (!step) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (feedbackOpen) dismissFeedback();
      else finishSetup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, feedbackOpen]);

  if (!step) return null;

  const dismiss = feedbackOpen ? dismissFeedback : finishSetup;

  const pad = 8;
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const cardWidth = Math.min(336, vw - 32);
  const cardLeft = rect
    ? Math.max(16, Math.min(vw - cardWidth - 16, rect.left + rect.width / 2 - cardWidth / 2))
    : Math.max(16, (vw - cardWidth) / 2);
  const placeBelow = rect ? rect.top + rect.height + 190 < vh : false;
  const preferredTop = rect
    ? placeBelow
      ? rect.top + rect.height + 18
      : Math.max(16, rect.top - 190)
    : Math.max(16, vh / 2 - 95);
  const cardTop = Math.max(16, Math.min(preferredTop, Math.max(16, vh - 336)));

  return (
    <div className="fixed inset-0 z-[90] pointer-events-none" aria-live="polite">
      {rect && (
        <>
          <div className="absolute inset-x-0 top-0 bg-background/75" style={{ height: Math.max(0, rect.top - pad) }} />
          <div className="absolute inset-x-0 bottom-0 bg-background/75" style={{ top: rect.top + rect.height + pad }} />
          <div className="absolute bg-background/75" style={{ top: rect.top - pad, left: 0, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2 }} />
          <div className="absolute bg-background/75" style={{ top: rect.top - pad, left: rect.left + rect.width + pad, right: 0, height: rect.height + pad * 2 }} />
          <div
            className="absolute rounded-lg border-2 border-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_18%,transparent)] transition-all duration-300 motion-reduce:transition-none"
            style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          />
        </>
      )}
      {!rect && <div className="absolute inset-0 bg-background/75" />}

      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="onboarding-title"
        className="scrollbar-thin pointer-events-auto absolute overflow-y-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-2xl transition-[top,left] duration-300 motion-reduce:transition-none"
        style={{ top: cardTop, left: cardLeft, width: cardWidth, maxHeight: Math.max(240, vh - 32) }}
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