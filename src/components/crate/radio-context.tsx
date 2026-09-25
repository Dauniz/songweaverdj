import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { logListeningEvent } from "@/lib/radio.functions";
import { nextPathTrack } from "@/lib/path.functions";
import type { CardTrack } from "./TrackCard";

export type Road = "vibe" | "era" | "mixed";
export type RadioTrack = CardTrack & { why?: string };

/** Real Spotify tracks play through the Spotify embed; others need an audio preview. */
export function isPlayable(t: CardTrack) {
  return Boolean(t.preview_url || (t.spotify_id && !t.spotify_id.startsWith("demo-")));
}

export const STEER_CHIPS = [
  "Svenskt",
  "Engelskt",
  "UK",
  "Nostalgi",
  "Instrumental",
  "Lugnare",
  "Mer energi",
] as const;

type HistoryItem = { spotifyId: string; name: string; artists: string; outcome: "played" | "skipped" };

export type RadioState = {
  active: boolean;
  current: RadioTrack | null;
  seed: RadioTrack | null;
  seedPrompt: string;
  road: Road;
  chips: string[];
  history: HistoryItem[];
  consecutiveSkips: number;
  sessionId: string;
};

type Outcome = "played" | "skipped" | "replay";

type RadioContextValue = {
  radio: RadioState;
  upNext: RadioTrack | null;
  thinking: boolean;
  askSteer: boolean;
  dismissSteer: () => void;
  startRadio: (tracks: CardTrack[], seedPrompt: string, startAt?: number) => void;
  stopRadio: () => void;
  next: (outcome: Outcome) => void;
  toggleChip: (chip: string) => void;
};

const RadioContext = createContext<RadioContextValue | null>(null);

const IDLE: RadioState = {
  active: false,
  current: null,
  seed: null,
  seedPrompt: "",
  road: "vibe",
  chips: [],
  history: [],
  consecutiveSkips: 0,
  sessionId: "",
};

const NOSTALGIA = /nostalg|minns|remember|throwback|back in|förr|gamla|\b(19|20)\d\d\b|era|då när/i;

type Branch = { track: RadioTrack; road: Road } | null;

/** Pure road logic: what the next state looks like after an outcome. */
function advance(s: RadioState, outcome: "played" | "skipped"): RadioState {
  const cur = s.current!;
  const history = [
    ...s.history,
    { spotifyId: cur.spotify_id ?? cur.id, name: cur.name, artists: cur.artists, outcome },
  ].slice(-25);
  if (outcome === "played") return { ...s, history, consecutiveSkips: 0 };
  const skips = s.consecutiveSkips + 1;
  const road: Road = skips === 1 ? (s.road === "vibe" ? "era" : s.road === "era" ? "vibe" : "vibe") : "mixed";
  return { ...s, history, consecutiveSkips: skips, road };
}

export function RadioProvider({ children }: { children: ReactNode }) {
  const [radio, setRadio] = useState<RadioState>(IDLE);
  const [thinking, setThinking] = useState(false);
  const [askSteer, setAskSteer] = useState(false);
  const logFn = useServerFn(logListeningEvent);
  const pathFn = useServerFn(nextPathTrack);
  const qc = useQueryClient();

  const radioRef = useRef(radio);
  radioRef.current = radio;
  const artistSkips = useRef<Map<string, number>>(new Map());
  const played = useRef<string[]>([]);
  // Two prefetched branches per song: one assuming you finish it, one assuming you skip it.
  const branches = useRef<{ key: string; played: Promise<Branch>; skipped: Promise<Branch> } | null>(
    null,
  );
  const [upNext, setUpNext] = useState<RadioTrack | null>(null);
  const lastSteerAsk = useRef(0);

  const avoidArtists = () =>
    [...artistSkips.current.entries()].filter(([, n]) => n >= 2).map(([a]) => a);

  const log = useCallback(
    (track: { id?: string | null; name: string; artists: string } | null, event: string, s: RadioState) => {
      logFn({
        data: {
          trackId: track?.id && !String(track.id).startsWith("demo") ? track.id : null,
          trackName: track?.name ?? "",
          artists: track?.artists ?? "",
          event: event as "play_through",
          sessionId: s.sessionId || "none",
          mode: s.road,
        },
      })
        .then((r) => {
          if (r?.learned?.length) qc.invalidateQueries({ queryKey: ["memories"] });
        })
        .catch(() => null);
    },
    [logFn, qc],
  );

  const fetchBranch = useCallback(
    async (s: RadioState): Promise<Branch> => {
      if (!s.seed) return null;
      try {
        const r = await pathFn({
          data: {
            seed: {
              spotifyId: s.seed.spotify_id ?? s.seed.id,
              name: s.seed.name,
              artists: s.seed.artists,
            },
            seedPrompt: s.seedPrompt.slice(0, 1000),
            history: s.history,
            road: s.road,
            chips: s.chips,
            avoidArtists: avoidArtists(),
            excludeSpotifyIds: [
              ...played.current.slice(-500),
              ...(s.current?.spotify_id ? [s.current.spotify_id] : []),
            ],
          },
        });
        if (!r.track) return null;
        return { track: { ...(r.track as CardTrack), why: r.why }, road: r.road };
      } catch {
        return null;
      }
    },
    [pathFn],
  );

  // Whenever the current song (or steering) changes, prefetch both branches.
  const prefetch = useCallback(
    (s: RadioState) => {
      if (!s.active || !s.current) return;
      const key = `${s.current.id}|${s.chips.join(",")}|${s.road}|${s.history.length}`;
      if (branches.current?.key === key) return;
      const playedB = fetchBranch(advance(s, "played"));
      const skippedB = fetchBranch(advance(s, "skipped"));
      branches.current = { key, played: playedB, skipped: skippedB };
      setUpNext(null);
      playedB.then((b) => {
        if (branches.current?.key === key) setUpNext(b?.track ?? null);
      });
    },
    [fetchBranch],
  );

  useEffect(() => {
    prefetch(radio);
  }, [radio, prefetch]);

  const startRadio = useCallback(
    (tracks: CardTrack[], seedPrompt: string, startAt = 0) => {
      const ordered = [...tracks.slice(startAt), ...tracks.slice(0, startAt)];
      const first = ordered.find(isPlayable) ?? null;
      artistSkips.current = new Map();
      played.current = [];
      branches.current = null;
      setAskSteer(false);
      if (!first) {
        setRadio(IDLE);
        return;
      }
      setRadio({
        ...IDLE,
        active: true,
        current: first,
        seed: first,
        seedPrompt,
        road: NOSTALGIA.test(seedPrompt) ? "era" : "vibe",
        sessionId: crypto.randomUUID(),
      });
    },
    [],
  );

  const stopRadio = useCallback(() => {
    branches.current = null;
    setAskSteer(false);
    setRadio(IDLE);
  }, []);

  const next = useCallback(
    async (outcome: Outcome) => {
      const s = radioRef.current;
      if (!s.active || !s.current) return;
      const cur = s.current;
      if (outcome === "replay") {
        log(cur, "replay", s);
        setRadio({ ...s, current: { ...cur } }); // new object -> player restarts
        return;
      }
      log(cur, outcome === "played" ? "play_through" : "early_skip", s);
      if (cur.spotify_id) played.current.push(cur.spotify_id);
      if (outcome === "skipped") {
        artistSkips.current.set(cur.artists, (artistSkips.current.get(cur.artists) ?? 0) + 1);
      }
      const nextState = advance(s, outcome);
      if (nextState.consecutiveSkips >= 2 && Date.now() - lastSteerAsk.current > 60_000) {
        lastSteerAsk.current = Date.now();
        setAskSteer(true);
      }
      const pending = branches.current?.[outcome];
      setThinking(true);
      let b = pending ? await pending : null;
      // The skip branch may now include an avoided artist — refetch if so.
      if (!b || avoidArtists().includes(b.track.artists)) b = await fetchBranch(nextState);
      setThinking(false);
      if (radioRef.current.sessionId !== s.sessionId) return; // stopped/restarted meanwhile
      if (!b) {
        setRadio({ ...nextState, current: null, active: false });
        return;
      }
      setRadio({ ...nextState, current: b.track, road: b.road });
    },
    [log, fetchBranch],
  );

  // Gentle periodic steering offer (~every 20 min of listening)
  useEffect(() => {
    if (!radio.active) return;
    const t = setInterval(() => {
      if (Date.now() - lastSteerAsk.current > 20 * 60_000) {
        lastSteerAsk.current = Date.now();
        setAskSteer(true);
      }
    }, 60_000);
    lastSteerAsk.current = Date.now();
    return () => clearInterval(t);
  }, [radio.active, radio.sessionId]);

  const toggleChip = useCallback(
    (chip: string) => {
      const s = radioRef.current;
      const on = !s.chips.includes(chip);
      const chips = on ? [...s.chips, chip] : s.chips.filter((c) => c !== chip);
      if (on) log({ name: chip, artists: "" }, "steer", s);
      branches.current = null; // steering invalidates the prefetched paths
      setRadio({ ...s, chips });
    },
    [log],
  );

  return (
    <RadioContext.Provider
      value={{
        radio,
        upNext,
        thinking,
        askSteer,
        dismissSteer: () => setAskSteer(false),
        startRadio,
        stopRadio,
        next,
        toggleChip,
      }}
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
