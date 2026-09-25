import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { logListeningEvent, refillRadioQueue } from "@/lib/radio.functions";
import type { CardTrack } from "./TrackCard";

export type RadioMode = "era" | "vibe";

export type RadioState = {
  active: boolean;
  queue: CardTrack[];
  currentIndex: number;
  mode: RadioMode | null;
  modeLabel: string | null;
  seedPrompt: string;
  sessionId: string;
};

type RadioContextValue = {
  radio: RadioState;
  startRadio: (tracks: CardTrack[], seedPrompt: string) => void;
  stopRadio: () => void;
  next: (reason: "ended" | "skipped" | "replay") => void;
  steer: (text: string) => Promise<void>;
  logEvent: (
    track: CardTrack,
    event: "play_through" | "early_skip" | "replay" | "explicit_fav" | "explicit_skip",
  ) => void;
  refilling: boolean;
};

const RadioContext = createContext<RadioContextValue | null>(null);

const IDLE: RadioState = {
  active: false,
  queue: [],
  currentIndex: 0,
  mode: null,
  modeLabel: null,
  seedPrompt: "",
  sessionId: "",
};

export function RadioProvider({ children }: { children: ReactNode }) {
  const [radio, setRadio] = useState<RadioState>(IDLE);
  const [refilling, setRefilling] = useState(false);
  const logFn = useServerFn(logListeningEvent);
  const refillFn = useServerFn(refillRadioQueue);
  const qc = useQueryClient();
  const feedbackRef = useRef<{ event: string; track: string }[]>([]);
  const playedIdsRef = useRef<string[]>([]);

  const logEvent = useCallback(
    (track: CardTrack, event: "play_through" | "early_skip" | "replay" | "explicit_fav" | "explicit_skip") => {
      feedbackRef.current = [
        ...feedbackRef.current.slice(-19),
        { event, track: `${track.name} — ${track.artists}` },
      ];
      logFn({
        data: {
          trackId: track.id ?? null,
          trackName: track.name,
          artists: track.artists,
          event,
          sessionId: radio.sessionId || "none",
          mode: radio.mode,
        },
      })
        .then((r) => {
          if (r?.learned?.length) qc.invalidateQueries({ queryKey: ["memories"] });
        })
        .catch(() => null);
    },
    [logFn, qc, radio.sessionId, radio.mode],
  );

  const refill = useCallback(
    async (state: RadioState, steering?: string) => {
      setRefilling(true);
      try {
        const r = await refillFn({
          data: {
            seedPrompt: state.seedPrompt,
            mode: state.mode,
            steering,
            excludeIds: playedIdsRef.current.slice(-200),
            recentFeedback: feedbackRef.current,
          },
        });
        setRadio((prev) => ({
          ...prev,
          queue: [...prev.queue, ...(r.tracks as CardTrack[])],
          mode: r.mode,
          modeLabel: r.modeLabel,
        }));
      } catch {
        // keep playing what's left; next refill attempt happens on the next advance
      } finally {
        setRefilling(false);
      }
    },
    [refillFn],
  );

  const startRadio = useCallback(
    (tracks: CardTrack[], seedPrompt: string) => {
      const playable = tracks.filter((t) => t.preview_url);
      // If none of the picks are playable, start empty — the background refill
      // will queue playable tracks from the library.
      feedbackRef.current = [];
      playedIdsRef.current = [];
      const state: RadioState = {
        active: true,
        queue: playable,
        currentIndex: 0,
        mode: null,
        modeLabel: null,
        seedPrompt,
        sessionId: crypto.randomUUID(),
      };
      setRadio(state);
      // Classify mode + top up the queue in the background
      void refill(state);
    },
    [refill],
  );

  const stopRadio = useCallback(() => setRadio(IDLE), []);

  const next = useCallback(
    (reason: "ended" | "skipped" | "replay") => {
      setRadio((prev) => {
        if (!prev.active) return prev;
        const current = prev.queue[prev.currentIndex];
        if (current) {
          if (reason === "ended") logEvent(current, "play_through");
          if (reason === "skipped") logEvent(current, "early_skip");
          if (reason === "replay") logEvent(current, "replay");
          playedIdsRef.current.push(current.id);
        }
        const nextIndex = reason === "replay" ? prev.currentIndex : prev.currentIndex + 1;
        const remaining = prev.queue.length - nextIndex;
        if (remaining < 3 && !refilling) void refill({ ...prev, currentIndex: nextIndex });
        if (remaining <= 0) return prev; // wait for refill
        return { ...prev, currentIndex: nextIndex };
      });
    },
    [logEvent, refill, refilling],
  );

  const steer = useCallback(
    async (text: string) => {
      if (!radio.active) return;
      await refill(radio, text);
    },
    [radio, refill],
  );

  return (
    <RadioContext.Provider
      value={{ radio, startRadio, stopRadio, next, steer, logEvent, refilling }}
    >
      {children}
    </RadioContext.Provider>
  );
}

export function useRadio() {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio must be used inside RadioProvider");
  return ctx;
}
