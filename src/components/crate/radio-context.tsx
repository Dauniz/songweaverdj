import { LIVE_KEY, readLiveSession } from "@/lib/live-session";

const LAST_KEY = "songweaver-last-session";
/** End the session when Spotify shows no open device for this long. */
const NO_DEVICE_GRACE = 20_000;
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { logListeningEvent } from "@/lib/radio.functions";
import { nextPathTrack } from "@/lib/path.functions";
import { LENS_IDS, type LensId } from "@/lib/lenses";
import { endSpotifySession, getSpotifyAuthUrl, getSpotifyPlayback, playSpotifyTrack } from "@/lib/spotify.functions";
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

export type MazeEvent = { at: number; kind: "start" | "finish" | "skip" | "pick" | "reroot"; text: string };
const ROAD_NAME: Record<Road, string> = { vibe: "Vibe road", era: "Era road", mixed: "New angle" };

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
  lens: LensId | null;
  setLens: (lens: LensId | null) => void;
  sessionLive: boolean;
  startSession: () => Promise<void>;
  endSession: () => void;
  hasLastSession: boolean;
  resumeLastSession: () => void;
  events: MazeEvent[];
  spotifyIdle: boolean;
};

// Keep one context instance across hot reloads so provider and consumers never diverge.
const g = globalThis as { __songweaverRadioCtx?: import("react").Context<RadioContextValue | null> };
const RadioContext = (g.__songweaverRadioCtx ??= createContext<RadioContextValue | null>(null));

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
  // Second-class branch (lens): one at a time, remembered on this device.
  const [lens, setLensState] = useState<LensId | null>(null);
  const lensRef = useRef<LensId | null>(null);
  lensRef.current = lens;
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("songweaver-lens");
      if (v && (LENS_IDS as string[]).includes(v)) setLensState(v as LensId);
    } catch { /* ignore */ }
  }, []);
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
  const lastPlayback = useRef({ spotifyId: "", ratio: 0, observed: false, progressMs: 0, durationMs: 0, at: 0 });
  const advancing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionLive, setSessionLive] = useState(false);
  // Track Spotify is already playing (user-chosen in Spotify) — don't restart it.
  const noPlayFor = useRef("");
  // The single song lined up behind the current one in Spotify (the "if you skip" door).
  const door = useRef<{ forId: string; track: RadioTrack } | null>(null);
  // "If you skip" door for the upcoming song, computed before the hand-over near the end.
  const preSkip = useRef<{ forId: string; branch: Branch } | null>(null);
  const swapping = useRef("");
  // When Crate last moved to a new song — rapid skips right after this are followed, not re-rooted.
  const lastTransition = useRef(0);
  const idleSince = useRef(0);
  const [events, setEvents] = useState<MazeEvent[]>([]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [spotifyIdle, setSpotifyIdle] = useState(false);
  // When Spotify stopped reporting any active device (app closed).
  const noDeviceSince = useRef(0);
  const [hasLastSession, setHasLastSession] = useState(false);
  useEffect(() => {
    setHasLastSession(Boolean(localStorage.getItem(LAST_KEY)));
  }, []);
  // Resume a live session on this device after a reload / tab switch (fresh within 30 min).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = readLiveSession();
    setRestored(true);
    if (!saved) return;
    played.current = saved.played ?? [];
    artistSkips.current = new Map(saved.artistSkips ?? []);
    if (saved.radio.current?.spotify_id) {
      noPlayFor.current = saved.radio.current.spotify_id;
      lastPlayback.current = { ...lastPlayback.current, spotifyId: saved.radio.current.spotify_id, observed: true, at: Date.now() };
    }
    setEvents(saved.events ?? []);
    // Keep the doors Crate had already chosen — don't re-roll them on reload.
    if (saved.branchKey && (saved.upNext || saved.upSkip)) {
      branches.current = {
        key: saved.branchKey,
        played: Promise.resolve(saved.upNext ? { track: saved.upNext, road: saved.radio.road } : null),
        skipped: Promise.resolve(saved.upSkip ?? null),
      };
      setUpNext(saved.upNext ?? null);
      setUpSkip(saved.upSkip ?? null);
    }
    if (saved.door) door.current = saved.door;
    setRadio(saved.radio);
    setSessionLive(saved.sessionLive);
  }, []);
  useEffect(() => {
    if (!restored) return;
    if (!sessionLive && !radio.active) {
      localStorage.removeItem(LIVE_KEY);
      return;
    }
    localStorage.setItem(
      LIVE_KEY,
      JSON.stringify({
        radio, sessionLive, events, played: played.current,
        artistSkips: [...artistSkips.current], savedAt: Date.now(),
        upNext, upSkip, door: door.current, branchKey: branches.current?.key ?? null,
      }),
    );
  }, [restored, radio, sessionLive, events, upNext, upSkip]);
  const note = useCallback((kind: MazeEvent["kind"], text: string) => {
    setEvents((e) => [...e, { at: Date.now(), kind, text }].slice(-30));
  }, []);
  const noteMove = useCallback(
    (from: { name: string }, outcome: "played" | "skipped", to: RadioTrack, road: Road) => {
      note(
        outcome === "played" ? "finish" : "skip",
        outcome === "played"
          ? `Finished "${from.name}" → Crate stays on ${ROAD_NAME[road]}`
          : `Skipped "${from.name}" → Crate turns to ${ROAD_NAME[road]}`,
      );
      note("pick", `Next: "${to.name}"${to.why ? ` — ${to.why}` : ""}`);
    },
    [note],
  );

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
            lens: lensRef.current,
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
      const key = `${s.current.id}|${s.chips.join(",")}|${s.road}|${s.history.length}|${lensRef.current ?? ""}`;
      if (branches.current?.key === key) return;
      const playedB = fetchBranch(advance(s, "played"));
      const pre = preSkip.current;
      const skippedB =
        pre && pre.forId === s.current.spotify_id ? Promise.resolve(pre.branch) : fetchBranch(advance(s, "skipped"));
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
      const road: Road = NOSTALGIA.test(seedPrompt) ? "era" : "vibe";
      setRadio({
        ...IDLE,
        active: true,
        current: first,
        seed: first,
        seedPrompt,
        road,
        sessionId: crypto.randomUUID(),
      });
      setEvents([
        {
          at: Date.now(),
          kind: "start",
          text: `Starts from "${first.name}" on ${ROAD_NAME[road]}${road === "era" ? " (you mentioned nostalgia)" : ""}`,
        },
      ]);
      setSessionLive(true);
      idleSince.current = 0;
    },
    [note],
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
      door.current = null;
      lastPlayback.current = { spotifyId: "", ratio: 0, observed: false, progressMs: 0, durationMs: 0, at: 0 };
      setRadio({ ...s, current: track, seed: track });
      log(track, "steer", s); // a deliberate choice — Walrus learns from it
      note("reroot", `You picked "${track.name}" → the path continues from here`);
    },
    [startRadio, log, note],
  );

  const stopRadio = useCallback((opts?: { keepSpotify?: boolean }) => {
    // Remember where in the maze Crate was, so the session can be resumed later.
    const s = radioRef.current;
    if (s.active && s.current) {
      localStorage.setItem(
        LAST_KEY,
        JSON.stringify({ radio: s, events: eventsRef.current, played: played.current, artistSkips: [...artistSkips.current], savedAt: Date.now() }),
      );
      setHasLastSession(true);
    }
    branches.current = null;
    setAskSteer(false);
    setPlaybackIssue(null);
    door.current = null;
    preSkip.current = null;
    setSessionLive(false);
    setSpotifyIdle(false);
    setRadio(IDLE);
    localStorage.removeItem(LIVE_KEY);
    // Hand Spotify back clean: pause and drop the songs Crate had lined up.
    if (!opts?.keepSpotify) void endSpotifySession().catch(() => undefined);
  }, []);

  const resumeLastSession = useCallback(() => {
    try {
      const raw = localStorage.getItem(LAST_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { radio: RadioState; events: MazeEvent[]; played: string[]; artistSkips: [string, number][] };
      played.current = saved.played ?? [];
      artistSkips.current = new Map(saved.artistSkips ?? []);
      branches.current = null;
      door.current = null;
      preSkip.current = null;
      noPlayFor.current = "";
      idleSince.current = 0;
      noDeviceSince.current = 0;
      lastPlayback.current = { spotifyId: "", ratio: 0, observed: false, progressMs: 0, durationMs: 0, at: 0 };
      setEvents([...(saved.events ?? []), { at: Date.now(), kind: "reroot" as const, text: `Resumed last session at "${saved.radio.current?.name}"` }].slice(-30));
      setRadio({ ...saved.radio, active: true, sessionId: crypto.randomUUID() });
      setSessionLive(true);
    } catch {
      localStorage.removeItem(LAST_KEY);
      setHasLastSession(false);
    }
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
      noteMove(cur, outcome, b.track, b.road);
    },
    [log, fetchBranch, noteMove],
  );

  const startSpotifyPlayback = useCallback(
    async (track = radioRef.current.current, quiet = false, skipDoor?: RadioTrack | null, positionMs?: number) => {
      if (!track?.spotify_id || track.spotify_id.startsWith("demo-")) return false;
      const nextId = skipDoor?.spotify_id && isPlayable(skipDoor) ? skipDoor.spotify_id : undefined;
      setRetrying(true);
      try {
        const result = await playFn({ data: { spotifyId: track.spotify_id, nextId, positionMs } });
        if (result.status === "playing") {
          setPlaybackIssue(null);
          door.current = nextId && skipDoor ? { forId: track.spotify_id, track: skipDoor } : null;
          if (!positionMs) lastTransition.current = Date.now();
          lastPlayback.current = {
            spotifyId: track.spotify_id,
            ratio: 0,
            observed: Boolean(positionMs),
            progressMs: positionMs ?? 0,
            durationMs: lastPlayback.current.durationMs,
            at: Date.now(),
          };
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
    // Crate only touches Spotify playback while a session is live.
    if (!sessionLive || !radio.active || !current?.spotify_id || current.spotify_id.startsWith("demo-")) return;
    if (noPlayFor.current === current.spotify_id) {
      noPlayFor.current = "";
      return; // Spotify is already playing it
    }
    void startSpotifyPlayback(current);
  }, [sessionLive, radio.active, radio.current?.spotify_id, startSpotifyPlayback]);

  // Spotify owns playback. Observe its active track so skips and completions still steer Crate's path.
  /** Accept a song Spotify is already playing as the new current song. */
  const acceptObserved = useCallback(
    (track: RadioTrack, outcome: "played" | "skipped", reroot: boolean, progressMs = 0, durationMs = 0) => {
      const s = radioRef.current;
      if (!s.current) return;
      log(s.current, outcome === "played" ? "play_through" : "early_skip", s);
      if (s.current.spotify_id) played.current.push(s.current.spotify_id);
      if (outcome === "skipped") {
        artistSkips.current.set(s.current.artists, (artistSkips.current.get(s.current.artists) ?? 0) + 1);
      }
      const nextState = advance(s, outcome);
      noPlayFor.current = track.spotify_id ?? "";
      lastTransition.current = Date.now();
      lastPlayback.current = { spotifyId: track.spotify_id ?? "", ratio: 0, observed: true, progressMs, durationMs, at: Date.now() };
      door.current = null;
      branches.current = null;
      if (reroot) note("reroot", `You played "${track.name}" in Spotify → new starting point`);
      else noteMove(s.current, outcome, track, nextState.road);
      setRadio(
        reroot
          ? { ...nextState, current: track, seed: track, consecutiveSkips: 0 }
          : { ...nextState, current: track },
      );
    },
    [log, note, noteMove],
  );

  // Line up exactly one song behind the current one: the "if you skip" door.
  // Spotify then lands on it if you skip; near the end Crate swaps in the "if you finish" pick.
  useEffect(() => {
    const cur = radio.current;
    const skip = upSkip?.track;
    if (!sessionLive || !cur?.spotify_id || !skip?.spotify_id || !isPlayable(skip)) return;
    if (door.current?.forId === cur.spotify_id) return;
    if (lastPlayback.current.spotifyId !== cur.spotify_id) return;
    door.current = { forId: cur.spotify_id, track: skip };
    let cancelled = false;
    void (async () => {
      // Read Spotify's real position right now so re-sending the line-up doesn't jump back.
      let pos: number | null = null;
      try {
        const st = await playbackFn();
        if (st.status === "ready" && st.spotifyId === cur.spotify_id) {
          if (st.durationMs && st.durationMs - st.progressMs < 30_000) return; // hand-over covers it
          pos = st.progressMs + 250; // small network allowance
        }
      } catch {
        /* fall back to estimate */
      }
      if (cancelled || radioRef.current.current?.spotify_id !== cur.spotify_id) {
        if (door.current?.forId === cur.spotify_id) door.current = null;
        return;
      }
      if (pos === null) {
        const lp = lastPlayback.current;
        pos = Math.max(0, lp.progressMs + (Date.now() - lp.at));
      }
      noPlayFor.current = "";
      void startSpotifyPlayback(cur, true, skip, Math.max(1, Math.round(pos)));
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionLive, radio.current, upSkip, startSpotifyPlayback, playbackFn]);

  /** A few seconds before the song ends: replace the line-up with
   *  ["if you finish" pick, its own "if you skip" door]. */
  const handOver = useCallback(
    async (remainingMs: number) => {
      const s = radioRef.current;
      const cur = s.current;
      if (!cur?.spotify_id || swapping.current === cur.spotify_id) return;
      swapping.current = cur.spotify_id;
      const deadline = Date.now() + remainingMs;
      const finishB = await branches.current?.played;
      if (!finishB?.track.spotify_id || !isPlayable(finishB.track)) return; // Spotify will just continue
      const afterState = { ...advance(s, "played"), current: finishB.track, road: finishB.road };
      const skipB = await Promise.race([
        fetchBranch(advance(afterState, "skipped")),
        new Promise<Branch>((res) => setTimeout(() => res(null), Math.max(0, deadline - Date.now() - 4_000))),
      ]);
      await new Promise((res) => setTimeout(res, Math.max(0, deadline - Date.now() - 2_500)));
      const now = radioRef.current;
      if (now.sessionId !== s.sessionId || now.current?.spotify_id !== cur.spotify_id) return; // you moved on yourself
      if (skipB) preSkip.current = { forId: finishB.track.spotify_id, branch: skipB };
      log(cur, "play_through", s);
      played.current.push(cur.spotify_id);
      noPlayFor.current = finishB.track.spotify_id;
      branches.current = null;
      setRadio(afterState);
      noteMove(cur, "played", finishB.track, finishB.road);
      await startSpotifyPlayback(finishB.track, true, skipB?.track ?? null);
      lastPlayback.current = { ...lastPlayback.current, observed: true };
    },
    [fetchBranch, log, startSpotifyPlayback, noteMove],
  );

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
          // Spotify reports no open device at all → Spotify is closed; end the session.
          if (state.status === "idle" || state.status === "no_device") {
            if (!noDeviceSince.current) noDeviceSince.current = Date.now();
            else if (Date.now() - noDeviceSince.current > NO_DEVICE_GRACE) {
              noDeviceSince.current = 0;
              stopRadio({ keepSpotify: true });
              return;
            }
          } else noDeviceSince.current = 0;
          if (idleSince.current && Date.now() - idleSince.current > 12_000) setSpotifyIdle(true);
          if (!idleSince.current) idleSince.current = Date.now();
          else if (Date.now() - idleSince.current > 30 * 60_000) {
            stopRadio(); // idle ~30 min: hand Spotify back
            return;
          }
        } else {
          idleSince.current = 0;
          noDeviceSince.current = 0;
          setSpotifyIdle(false);
        }
        if (state.status === "ready" && state.spotifyId === current.spotify_id) {
          lastPlayback.current = {
            spotifyId: current.spotify_id,
            ratio: state.durationMs ? state.progressMs / state.durationMs : previous.ratio,
            observed: true,
            progressMs: state.progressMs,
            durationMs: state.durationMs,
            at: Date.now(),
          };
          const remaining = state.durationMs - state.progressMs;
          if (playing && state.durationMs && remaining < 25_000) void handOver(remaining);
          return;
        }
        if (previous.spotifyId !== current.spotify_id) return;
        const sinceMove = Date.now() - lastTransition.current;
        const rapid = sinceMove < 15_000;
        // Not seen playing yet: only a rapid skip (after Spotify had time to start it) counts.
        if (!previous.observed && !(rapid && sinceMove > 2_500)) return;
        const outcome = previous.ratio >= 0.7 ? "played" : "skipped";
        if (state.status === "ready" && state.spotifyId) {
          const q = door.current;
          if (q && q.forId === current.spotify_id && q.track.spotify_id === state.spotifyId) {
            // you skipped onto Crate's "if you skip" door
            acceptObserved(q.track, outcome, false, state.progressMs, state.durationMs);
          } else if (rapid && outcome === "skipped") {
            // Skipped again before the next door was lined up: Spotify fell off the end of
            // the list. Keep up — follow the skip road instead of treating it as your own pick.
            advancing.current = true;
            try {
              await next("skipped");
            } finally {
              advancing.current = false;
            }
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
    // Poll fast right after a move so rapid skips are caught, slower once the song settles.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await check();
      if (stopped) return;
      const fast = Date.now() - lastTransition.current < 15_000;
      timer = setTimeout(() => void loop(), fast ? 1_200 : 4_000);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionLive, radio.active, radio.sessionId, playbackIssue, playbackFn, next, acceptObserved, stopRadio, handOver]);

  // "Open Spotify" issue left unresolved for a minute → Spotify isn't coming; end the session.
  useEffect(() => {
    if (!sessionLive || playbackIssue?.status !== "no_device") return;
    const t = setTimeout(() => stopRadio({ keepSpotify: true }), 60_000);
    return () => clearTimeout(t);
  }, [sessionLive, playbackIssue, stopRadio]);

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
        lastPlayback.current = {
          spotifyId: state.spotifyId, ratio: 0, observed: true,
          progressMs: state.progressMs, durationMs: state.durationMs, at: Date.now(),
        };
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

  const setLens = useCallback(
    (next: LensId | null) => {
      lensRef.current = next;
      setLensState(next);
      try {
        window.localStorage.setItem("songweaver-lens", next ?? "");
      } catch { /* ignore */ }
      const s = radioRef.current;
      if (next && s.active) log({ name: `lens:${next}`, artists: "" }, "steer", s);
      branches.current = null; // lens bends both prefetched paths
      if (s.active) setRadio({ ...s });
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
        lens,
        setLens,
        sessionLive,
        startSession,
        endSession: () => stopRadio(),
        hasLastSession,
        resumeLastSession,
        events,
        spotifyIdle,
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
