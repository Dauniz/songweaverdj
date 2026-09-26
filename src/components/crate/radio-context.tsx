import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { logListeningEvent } from "@/lib/radio.functions";
import { nextPathTrack } from "@/lib/path.functions";
import { getSpotifyAuthUrl, getSpotifyPlayback, playSpotifyTrack, queueSpotifyTrack } from "@/lib/spotify.functions";
import type { CardTrack } from "./TrackCard";
import { SpotifyOpenDialog } from "./SpotifyOpenDialog";
import { SteerChips } from "./SteerChips";

export type Road = "vibe" | "era" | "mixed";
export type RadioTrack = CardTrack & { why?: string };
export type SpotifyPlaybackIssue = {
  status: "no_device" | "premium_required" | "connect_required" | "unavailable";
  message: string;
};

/** Spotify Connect can play only real Spotify catalog tracks. */
export function isPlayable(t: CardTrack) {
  return Boolean(t.spotify_id && !t.spotify_id.startsWith("demo-"));
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
  upSkip: { track: RadioTrack; road: Road } | null;
  thinking: boolean;
  askSteer: boolean;
  dismissSteer: () => void;
  startRadio: (tracks: CardTrack[], seedPrompt: string, startAt?: number) => void;
  rerootTo: (track: CardTrack) => void;
  stopRadio: () => void;
  next: (outcome: Outcome) => void;
  toggleChip: (chip: string) => void;
  sessionLive: boolean;
  startSession: () => Promise<void>;
  endSession: () => void;
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
  const playFn = useServerFn(playSpotifyTrack);
  const playbackFn = useServerFn(getSpotifyPlayback);
  const authUrlFn = useServerFn(getSpotifyAuthUrl);
  const qc = useQueryClient();
  const [playbackIssue, setPlaybackIssue] = useState<SpotifyPlaybackIssue | null>(null);
  const [retrying, setRetrying] = useState(false);

  const radioRef = useRef(radio);
  radioRef.current = radio;
  const artistSkips = useRef<Map<string, number>>(new Map());
  const played = useRef<string[]>([]);
  // Two prefetched branches per song: one assuming you finish it, one assuming you skip it.
  const branches = useRef<{ key: string; played: Promise<Branch>; skipped: Promise<Branch> } | null>(
    null,
  );
  const [upNext, setUpNext] = useState<RadioTrack | null>(null);
  const [upSkip, setUpSkip] = useState<{ track: RadioTrack; road: Road } | null>(null);
  const lastSteerAsk = useRef(0);
  const lastSkipAsk = useRef(0);
  const lastPlayback = useRef({ spotifyId: "", ratio: 0, observed: false });
  const advancing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueFn = useServerFn(queueSpotifyTrack);
  const [sessionLive, setSessionLive] = useState(false);
  // Track Spotify is already playing (user-chosen in Spotify) — don't restart it.
  const noPlayFor = useRef("");
  // Crate's pick queued in Spotify for the current song.
  const queued = useRef<{ forId: string; track: RadioTrack } | null>(null);
  const idleSince = useRef(0);

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
      setUpSkip(null);
      skippedB.then((b) => {
        if (branches.current?.key === key) setUpSkip(b ?? null);
      });
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
      setSessionLive(true);
      idleSince.current = 0;
    },
    [],
  );

  /** Play a searched song: with no session running it starts a fresh one;
   *  mid-session it re-roots the path from that song while keeping the trail,
   *  road, chips and skipped-artist memory — like picking it in Spotify. */
  const rerootTo = useCallback(
    (track: CardTrack) => {
      const s = radioRef.current;
      if (!s.active) {
        startRadio([track], "");
        return;
      }
      branches.current = null; // the prefetched doors are stale from here on
      queued.current = null;
      lastPlayback.current = { spotifyId: "", ratio: 0, observed: false };
      setRadio({ ...s, current: track, seed: track });
      log(track, "steer", s); // a deliberate choice — Walrus learns from it
    },
    [startRadio, log],
  );

  const stopRadio = useCallback(() => {
    branches.current = null;
    setAskSteer(false);
    setPlaybackIssue(null);
    queued.current = null;
    setSessionLive(false);
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
      if (nextState.consecutiveSkips >= 2 && Date.now() - lastSkipAsk.current > 60_000) {
        lastSkipAsk.current = Date.now();
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

  const startSpotifyPlayback = useCallback(
    async (track = radioRef.current.current, quiet = false) => {
      if (!track?.spotify_id || track.spotify_id.startsWith("demo-")) return false;
      setRetrying(true);
      try {
        const result = await playFn({ data: { spotifyId: track.spotify_id } });
        if (result.status === "playing") {
          setPlaybackIssue(null);
          lastPlayback.current = { spotifyId: track.spotify_id, ratio: 0, observed: false };
          return true;
        }
        if (!quiet) setPlaybackIssue({ status: result.status, message: result.message });
        return false;
      } catch {
        if (!quiet) setPlaybackIssue({ status: "unavailable", message: "Spotify playback is temporarily unavailable." });
        return false;
      } finally {
        setRetrying(false);
      }
    },
    [playFn],
  );

  useEffect(() => {
    const current = radio.current;
    if (!radio.active || !current?.spotify_id || current.spotify_id.startsWith("demo-")) return;
    if (noPlayFor.current === current.spotify_id) {
      noPlayFor.current = "";
      return; // Spotify is already playing it
    }
    void startSpotifyPlayback(current);
  }, [radio.active, radio.current?.spotify_id, startSpotifyPlayback]);

  // Spotify owns playback. Observe its active track so skips and completions still steer Crate's path.
  /** Accept a song Spotify is already playing as the new current song. */
  const acceptObserved = useCallback(
    (track: RadioTrack, outcome: "played" | "skipped", reroot: boolean) => {
      const s = radioRef.current;
      if (!s.current) return;
      log(s.current, outcome === "played" ? "play_through" : "early_skip", s);
      if (s.current.spotify_id) played.current.push(s.current.spotify_id);
      if (outcome === "skipped") {
        artistSkips.current.set(s.current.artists, (artistSkips.current.get(s.current.artists) ?? 0) + 1);
      }
      const nextState = advance(s, outcome);
      noPlayFor.current = track.spotify_id ?? "";
      lastPlayback.current = { spotifyId: track.spotify_id ?? "", ratio: 0, observed: true };
      branches.current = null;
      setRadio(
        reroot
          ? { ...nextState, current: track, seed: track, consecutiveSkips: 0 }
          : { ...nextState, current: track },
      );
    },
    [log],
  );

  // Queue Crate's "if you finish" pick in Spotify, once per song.
  useEffect(() => {
    const cur = radio.current;
    if (!sessionLive || !cur?.spotify_id || !upNext?.spotify_id || !isPlayable(upNext)) return;
    if (queued.current?.forId === cur.spotify_id) return;
    queued.current = { forId: cur.spotify_id, track: upNext };
    void queueFn({ data: { spotifyId: upNext.spotify_id } }).catch(() => null);
  }, [sessionLive, radio.current, upNext, queueFn]);

  // Spotify owns playback. While a session is live, mirror what Spotify plays —
  // skips, finishes and songs you pick yourself inside the Spotify app.
  useEffect(() => {
    if (!sessionLive || !radio.active || playbackIssue) return;
    const check = async () => {
      const current = radioRef.current.current;
      if (!current?.spotify_id || advancing.current) return;
      try {
        const state = await playbackFn();
        const previous = lastPlayback.current;
        const playing = state.status === "ready" && state.isPlaying;
        if (!playing) {
          if (!idleSince.current) idleSince.current = Date.now();
          else if (Date.now() - idleSince.current > 30 * 60_000) {
            stopRadio(); // idle ~30 min: hand Spotify back
            return;
          }
        } else idleSince.current = 0;
        if (state.status === "ready" && state.spotifyId === current.spotify_id) {
          lastPlayback.current = {
            spotifyId: current.spotify_id,
            ratio: state.durationMs ? state.progressMs / state.durationMs : previous.ratio,
            observed: true,
          };
          return;
        }
        if (previous.spotifyId !== current.spotify_id || !previous.observed) return;
        const outcome = previous.ratio >= 0.7 ? "played" : "skipped";
        if (state.status === "ready" && state.spotifyId) {
          const q = queued.current;
          if (q && q.forId === current.spotify_id && q.track.spotify_id === state.spotifyId) {
            acceptObserved(q.track, outcome, false); // landed on Crate's queued pick
          } else {
            acceptObserved(
              {
                id: `demo-ext-${state.spotifyId}`,
                spotify_id: state.spotifyId,
                name: state.name || "Unknown song",
                artists: state.artists,
                album: state.album,
                image_url: state.imageUrl,
                spotify_url: state.spotifyUrl,
                source_name: "Spotify",
              },
              outcome,
              true, // you picked it in Spotify — the path starts over from here
            );
          }
          return;
        }
        if (state.status === "idle") {
          advancing.current = true;
          await next(outcome);
          advancing.current = false;
        }
      } catch {
        // A later poll can recover without interrupting the listening session.
      }
    };
    const timer = setInterval(() => void check(), 4_000);
    void check();
    return () => clearInterval(timer);
  }, [sessionLive, radio.active, radio.sessionId, playbackIssue, playbackFn, next, acceptObserved, stopRadio]);

  const startSession = useCallback(async () => {
    setSessionLive(true);
    idleSince.current = 0;
    if (radioRef.current.active) return;
    try {
      const state = await playbackFn();
      if (state.status === "ready" && state.spotifyId) {
        const track: RadioTrack = {
          id: `demo-ext-${state.spotifyId}`,
          spotify_id: state.spotifyId,
          name: state.name || "Unknown song",
          artists: state.artists,
          album: state.album,
          image_url: state.imageUrl,
          spotify_url: state.spotifyUrl,
          source_name: "Spotify",
        };
        noPlayFor.current = state.spotifyId;
        lastPlayback.current = { spotifyId: state.spotifyId, ratio: 0, observed: true };
        startRadio([track], "");
      }
    } catch {
      // No Spotify state yet — the session starts with the first prompt or play.
    }
  }, [playbackFn, startRadio]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "spotify-connected" || !event.data.ok) return;
      void startSpotifyPlayback();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [startSpotifyPlayback]);

  const openSpotify = useCallback(() => {
    const track = radioRef.current.current;
    if (!track?.spotify_id) return;
    // Close the popup and wait quietly for the user to open Spotify — it only
    // reappears if they press play again.
    setPlaybackIssue(null);
    // Try the installed desktop/mobile app first; if the page is still visible
    // shortly after, the app isn't installed, so fall back to Spotify Web.
    const webUrl = track.spotify_url ?? `https://open.spotify.com/track/${track.spotify_id}`;
    let appOpened = false;
    const onBlur = () => { appOpened = true; };
    const onVis = () => { if (document.hidden) appOpened = true; };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    window.location.href = `spotify:track:${track.spotify_id}`;
    setTimeout(() => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      if (!appOpened) window.open(webUrl, "_blank", "noopener,noreferrer");
    }, 1500);
    let attempts = 0;
    const retry = async () => {
      attempts += 1;
      if (await startSpotifyPlayback(track, true)) return;
      if (attempts < 10) retryTimer.current = setTimeout(() => void retry(), 3_000);
    };
    retryTimer.current = setTimeout(() => void retry(), 2_000);
  }, [startSpotifyPlayback]);

  const connectSpotify = useCallback(async () => {
    try {
      const { url } = await authUrlFn({ data: { origin: window.location.origin } });
      const popup = window.open(url, "spotify-auth", "width=520,height=720");
      if (!popup) window.location.href = url;
    } catch {
      setPlaybackIssue({ status: "unavailable", message: "Spotify could not be connected." });
    }
  }, [authUrlFn]);

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

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
        upSkip,
        thinking,
        askSteer,
        dismissSteer: () => setAskSteer(false),
        startRadio,
        rerootTo,
        stopRadio,
        next,
        toggleChip,
        sessionLive,
        startSession,
        endSession: stopRadio,
      }}
    >
      {children}
      {askSteer && (
        <SteerChips
          prompt
          active={radio.chips}
          onToggle={toggleChip}
          onClose={() => setAskSteer(false)}
        />
      )}
      <SpotifyOpenDialog
        issue={playbackIssue}
        track={radio.current}
        retrying={retrying}
        onDismiss={() => setPlaybackIssue(null)}
        onOpenSpotify={openSpotify}
        onConnect={() => void connectSpotify()}
        onRetry={() => void startSpotifyPlayback()}
      />
    </RadioContext.Provider>
  );
}

export function useRadio() {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio must be used inside RadioProvider");
  return ctx;
}
