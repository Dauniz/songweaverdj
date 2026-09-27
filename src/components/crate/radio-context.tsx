import { LIVE_KEY, readLiveSession } from "@/lib/live-session";

const LAST_KEY = "songweaver-last-session";
/** End the session when Spotify shows no open device for this long. */
const NO_DEVICE_GRACE = 5 * 60_000;
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { logListeningEvent } from "@/lib/radio.functions";
import { nextPathTrack, pathReserves } from "@/lib/path.functions";
import { LENS_IDS, type LensId } from "@/lib/lenses";
import { endSpotifySession, getSpotifyAuthUrl, getSpotifyPlayback, pauseSpotifyPlayback, playSpotifyTrack } from "@/lib/spotify.functions";
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

export type MazeEvent = { at: number; kind: "start" | "finish" | "skip" | "pick" | "reroot" | "think" | "door" | "steer"; text: string };
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
  deepCuts: boolean;
  setDeepCuts: (enabled: boolean) => void;
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
  const reservesFn = useServerFn(pathReserves);
  const playFn = useServerFn(playSpotifyTrack);
  const pauseFn = useServerFn(pauseSpotifyPlayback);
  const playbackFn = useServerFn(getSpotifyPlayback);
  const authUrlFn = useServerFn(getSpotifyAuthUrl);
  const qc = useQueryClient();
  const [playbackIssue, setPlaybackIssue] = useState<SpotifyPlaybackIssue | null>(null);
  const [retrying, setRetrying] = useState(false);

  const radioRef = useRef(radio);
  radioRef.current = radio;
  // Second-class branch: one at a time. It is restored only with a live/saved session.
  const [lens, setLensState] = useState<LensId | null>(null);
  const lensRef = useRef<LensId | null>(null);
  lensRef.current = lens;
  const [deepCuts, setDeepCutsState] = useState(false);
  const deepCutsRef = useRef(false);
  deepCutsRef.current = deepCuts;
  const artistSkips = useRef<Map<string, number>>(new Map());
  const played = useRef<string[]>([]);
  // Two prefetched branches per song: one assuming you finish it, one assuming you skip it.
  const branches = useRef<{ key: string; played: Promise<Branch>; skipped: Promise<Branch> } | null>(
    null,
  );
  const [upNext, setUpNext] = useState<RadioTrack | null>(null);
  const upNextRef = useRef<RadioTrack | null>(null);
  upNextRef.current = upNext;
  const [upSkip, setUpSkip] = useState<{ track: RadioTrack; road: Road } | null>(null);
  const lastSteerAsk = useRef(0);
  const lastSkipAsk = useRef(0);
  const lastPlayback = useRef({ spotifyId: "", ratio: 0, observed: false, progressMs: 0, durationMs: 0, at: 0 });
  const advancing = useRef(false);
  const committing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionLive, setSessionLive] = useState(false);
  // Track Spotify is already playing (user-chosen in Spotify) — don't restart it.
  const noPlayFor = useRef("");
  // The single song lined up behind the current one in Spotify (the "if you skip" door).
  const door = useRef<{ forId: string; track: RadioTrack } | null>(null);
  // "If you skip" door for the upcoming song, computed before the hand-over near the end.
  const preSkip = useRef<{ forId: string; branch: Branch } | null>(null);
  const scoutAbort = useRef<AbortController | null>(null);
  const lensTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preSkip2 = useRef<{ forId: string; branch: Branch } | null>(null);
  const upSkipRef = useRef<{ track: RadioTrack; road: Road } | null>(null);
  upSkipRef.current = upSkip;
  const sideSnap = useRef<{
    at: number; lens: LensId | null; deep: boolean; currentId: string | null | undefined; historyLen: number;
    branches: { key: string; played: Promise<Branch>; skipped: Promise<Branch> } | null;
    upNext: RadioTrack | null; upSkip: { track: RadioTrack; road: Road } | null;
    preSkip: { forId: string; branch: Branch } | null; preSkip2: { forId: string; branch: Branch } | null;
  } | null>(null);
  const swapping = useRef("");
  /** Song ids last sent to Spotify, in order — lets Crate skip re-sending when the next door is already lined up. */
  const lineup = useRef<string[]>([]);
  /** Code-picked back-ups (no AI) sent behind the doors so fast skips never empty Spotify's list. */
  const reserves = useRef<{ forId: string; tracks: RadioTrack[] }>({ forId: "", tracks: [] });
  /** Times Spotify was seen changing song — used to spot skip spamming. */
  const jumps = useRef<number[]>([]);
  /** While set, Crate stops reacting to Spotify: the listener is being asked to slow down. */
  const cooldownUntil = useRef(0);
  const calmingRef = useRef(false);
  // When Crate last moved to a new song — rapid skips right after this are followed, not re-rooted.
  const lastTransition = useRef(0);
  const idleSince = useRef(0);
  const [events, setEvents] = useState<MazeEvent[]>([]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [spotifyIdle, setSpotifyIdle] = useState(false);
  const [calming, setCalming] = useState(false);
  // When Spotify stopped reporting any active device (app closed).
  const noDeviceSince = useRef(0);
  // Last time we tried to wake Spotify back up after losing the device.
  const lastReconnectTry = useRef(0);
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
    const savedLens = saved.lens && (LENS_IDS as string[]).includes(saved.lens) ? saved.lens : null;
    lensRef.current = savedLens;
    setLensState(savedLens);
    const savedDeepCuts = savedLens ? false : Boolean(saved.deepCuts);
    deepCutsRef.current = savedDeepCuts;
    setDeepCutsState(savedDeepCuts);
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
        lens: lensRef.current, deepCuts: deepCutsRef.current,
      }),
    );
  }, [restored, radio, sessionLive, events, upNext, upSkip, lens, deepCuts]);
  const note = useCallback((kind: MazeEvent["kind"], text: string) => {
    setEvents((e) => [...e, { at: Date.now(), kind, text }].slice(-80));
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
    async (s: RadioState, signal?: AbortSignal, extraExclude: string[] = []): Promise<Branch> => {
      if (!s.seed) return null;
      try {
        const r = await pathFn({
          ...(signal ? { signal } : {}),
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
            deepCuts: deepCutsRef.current,
            avoidArtists: avoidArtists(),
            excludeSpotifyIds: [
              ...played.current.slice(-500),
              ...(s.current?.spotify_id ? [s.current.spotify_id] : []),
              ...extraExclude,
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
      if (calmingRef.current) return; // wait for the clicking to stop before looking for songs
      const key = `${s.current.id}|${s.chips.join(",")}|${s.road}|${s.history.length}|${lensRef.current ?? ""}|${deepCutsRef.current ? "deep" : ""}`;
      if (branches.current?.key === key) return;
      scoutAbort.current?.abort(); // drop any scouting still running for an old key
      const ctrl = new AbortController();
      scoutAbort.current = ctrl;
      const playedB = fetchBranch(advance(s, "played"), ctrl.signal);
      const pre = preSkip.current?.forId === s.current.spotify_id ? preSkip.current : preSkip2.current;
      const skippedState = advance(s, "skipped");
      const skippedB: Promise<Branch> =
        pre && pre.forId === s.current.spotify_id
          ? Promise.resolve(pre.branch)
          : playedB.then(async (finish) => {
              // The skip door must never be the same song as the finish door.
              const finishId = finish?.track.spotify_id;
              const first = await fetchBranch(skippedState, ctrl.signal, finishId ? [finishId] : []);
              if (first && finishId && first.track.spotify_id === finishId) {
                // Defensive: server ignored the exclusion (e.g. tiny pool) — retry excluding it.
                return fetchBranch(skippedState, ctrl.signal, [finishId, first.track.spotify_id]);
              }
              return first;
            });
      branches.current = { key, played: playedB, skipped: skippedB };
      setUpNext(null);
      setUpSkip(null);
      const skipRoad = advance(s, "skipped").road;
      const avoid = avoidArtists();
      const ctx = [
        lensRef.current ? `side road ${lensRef.current}` : null,
        s.chips.length ? `steering ${s.chips.join(", ")}` : null,
        avoid.length ? `avoiding ${avoid.join(", ")}` : null,
        `${played.current.length} songs already heard excluded`,
      ].filter(Boolean).join(" · ");
      note("think", `At "${s.current.name}" · on ${ROAD_NAME[s.road]} · skips in a row: ${s.consecutiveSkips}`);
      note("think", `Scouting two doors: finish → ${ROAD_NAME[s.road]}, skip → ${ROAD_NAME[skipRoad]}${s.consecutiveSkips >= 1 ? " (second skip = new angle)" : ""}`);
      note("think", ctx);
      skippedB.then((b) => {
        if (branches.current?.key !== key) return;
        setUpSkip(b ?? null);
        note("door", b ? `Skip door ready: "${b.track.name}" by ${b.track.artists}${b.track.why ? ` — ${b.track.why}` : ""}` : "Skip door: nothing fits, will fall back");
      });
      playedB.then((b) => {
        if (branches.current?.key !== key) return;
        setUpNext(b?.track ?? null);
        note("door", b ? `Finish door ready: "${b.track.name}" by ${b.track.artists}${b.track.why ? ` — ${b.track.why}` : ""}` : "Finish door: nothing fits, will fall back");
      });
    },
    [fetchBranch, note],
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
        JSON.stringify({ radio: s, events: eventsRef.current, played: played.current, artistSkips: [...artistSkips.current], lens: lensRef.current, deepCuts: deepCutsRef.current, savedAt: Date.now() }),
      );
      setHasLastSession(true);
    }
    // A brand new session starts clean: no side road carried over.
    lensRef.current = null;
    setLensState(null);
    deepCutsRef.current = false;
    setDeepCutsState(false);
    branches.current = null;
    setAskSteer(false);
    setPlaybackIssue(null);
    door.current = null;
    preSkip.current = null;
    preSkip2.current = null;
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
      const saved = JSON.parse(raw) as { radio: RadioState; events: MazeEvent[]; played: string[]; artistSkips: [string, number][]; lens?: LensId | null; deepCuts?: boolean };
      played.current = saved.played ?? [];
      // Bring back the side road the session was on.
      const savedLens = saved.lens && (LENS_IDS as string[]).includes(saved.lens) ? saved.lens : null;
      lensRef.current = savedLens;
      setLensState(savedLens);
      const savedDeepCuts = savedLens ? false : Boolean(saved.deepCuts);
      deepCutsRef.current = savedDeepCuts;
      setDeepCutsState(savedDeepCuts);
      artistSkips.current = new Map(saved.artistSkips ?? []);
      branches.current = null;
      door.current = null;
      preSkip.current = null;
    preSkip2.current = null;
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
    async (
      track = radioRef.current.current,
      quiet = false,
      skipDoor?: RadioTrack | null,
      positionMs?: number,
      thenDoor?: RadioTrack | null,
    ) => {
      if (!track?.spotify_id || track.spotify_id.startsWith("demo-")) return false;
      const nextId = skipDoor?.spotify_id && isPlayable(skipDoor) ? skipDoor.spotify_id : undefined;
      const thenId = nextId && thenDoor?.spotify_id && isPlayable(thenDoor) ? thenDoor.spotify_id : undefined;
      // Back-ups sit behind the doors: if you skip past everything, Spotify still has songs left.
      const used = new Set([track.spotify_id, nextId, thenId]);
      const reserveIds = reserves.current.tracks
        .map((t) => t.spotify_id)
        .filter((id): id is string => Boolean(id) && !used.has(id!))
        .slice(0, 2);
      setRetrying(true);
      try {
        const result = await playFn({ data: { spotifyId: track.spotify_id, nextId, thenId, reserveIds, positionMs } });
        if (result.status === "playing") {
          lineup.current = [
            track.spotify_id,
            ...(nextId ? [nextId] : []),
            ...(thenId ? [thenId] : []),
            ...(nextId ? reserveIds : []),
          ];
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

  // Keep two instant back-up songs ready for the current song (plain code, no AI cost).
  useEffect(() => {
    const cur = radio.current;
    if (!sessionLive || !cur?.spotify_id || !isPlayable(cur)) return;
    if (reserves.current.forId === cur.spotify_id) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await reservesFn({
          data: {
            seed: { spotifyId: cur.spotify_id!, name: cur.name, artists: cur.artists },
            road: radioRef.current.road,
            lens: lensRef.current,
            deepCuts: deepCutsRef.current,
            avoidArtists: avoidArtists(),
            excludeSpotifyIds: played.current.slice(-500),
            count: 2,
          },
        });
        if (!cancelled) reserves.current = { forId: cur.spotify_id!, tracks: r.tracks as RadioTrack[] };
      } catch {
        /* back-ups are optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionLive, radio.current?.spotify_id, reservesFn]);

  useEffect(() => {
    const current = radio.current;
    // Crate only touches Spotify playback while a session is live.
    if (!sessionLive || !radio.active || !current?.spotify_id || current.spotify_id.startsWith("demo-")) return;
    if (calmingRef.current) return;
    if (noPlayFor.current === current.spotify_id) {
      noPlayFor.current = "";
      return; // Spotify is already playing it
    }
    // Send the "if you skip" door in the very same call when it's already known:
    // adding it later would make Spotify re-buffer mid-song (an audible hiccup).
    const pre = preSkip.current?.forId === current.spotify_id ? preSkip.current.branch : null;
    const ready = pre ?? (upSkipRef.current && radioRef.current.current?.spotify_id === current.spotify_id ? upSkipRef.current : null);
    void startSpotifyPlayback(current, false, ready?.track ?? null);
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
    if (calmingRef.current) return; // hands off Spotify while Crate waits out the clicking
    if (door.current?.forId === cur.spotify_id && door.current.track.spotify_id === skip.spotify_id) return;
    if (lastPlayback.current.spotifyId !== cur.spotify_id) return;
    // Already lined up behind this song in Spotify (sent one step ahead) — no re-send, no glitch.
    const at = lineup.current.indexOf(cur.spotify_id);
    if (at >= 0 && lineup.current[at + 1] === skip.spotify_id) {
      door.current = { forId: cur.spotify_id, track: skip };
      return;
    }
    const skipRoad = upSkip!.road;
    let cancelled = false;
    void (async () => {
      // Small settle so rapid steering changes only send Spotify one line-up.
      await new Promise((res) => setTimeout(res, 400));
      if (cancelled || radioRef.current.current?.spotify_id !== cur.spotify_id) return;
      if (swapping.current === cur.spotify_id) return; // end-of-song hand-over owns the line-up now
      // Scout one step further (the skip door's own skip door) so the next skip needs no re-send.
      const s0 = radioRef.current;
      const onSkip = { ...advance(s0, "skipped"), current: skip, road: skipRoad };
      const then = await Promise.race([
        fetchBranch(advance(onSkip, "skipped")),
        new Promise<Branch>((res) => setTimeout(() => res(null), 2_000)),
      ]);
      if (cancelled || radioRef.current.current?.spotify_id !== cur.spotify_id) return;
      if (then) preSkip.current = { forId: skip.spotify_id!, branch: then };
      // Read Spotify's real position: re-sending the line-up restarts the audio buffer,
      // which is audible. Only do it while the song has barely started.
      let pos: number | null = null;
      try {
        const st = await playbackFn();
        if (st.status === "ready" && st.spotifyId === cur.spotify_id) pos = st.progressMs + 250;
      } catch {
        /* fall back to estimate */
      }
      if (cancelled || radioRef.current.current?.spotify_id !== cur.spotify_id || swapping.current === cur.spotify_id) return;
      if (pos === null) {
        const lp = lastPlayback.current;
        pos = Math.max(0, lp.progressMs + (Date.now() - lp.at));
      }
      if (pos > 6_000) {
        // Too late to line it up without a hiccup — if you skip in Spotify,
        // Crate follows from the poll and starts the door itself.
        door.current = null;
        return;
      }
      noPlayFor.current = "";
      await startSpotifyPlayback(cur, true, skip, Math.max(1, Math.round(pos)), then?.track ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionLive, radio.current, upSkip, startSpotifyPlayback, playbackFn, fetchBranch]);

  /** A few seconds before the song ends: replace the line-up with
   *  ["if you finish" pick, its own "if you skip" door]. */
  const handOver = useCallback(
    async (remainingMs: number) => {
      const s = radioRef.current;
      const cur = s.current;
      if (!cur?.spotify_id || swapping.current === cur.spotify_id) return;
      swapping.current = cur.spotify_id;
      const deadline = Date.now() + remainingMs;
      // Use exactly the "if you finish" pick shown on screen — never a different one.
      const shown = upNextRef.current;
      let finishB: Branch = shown?.spotify_id && isPlayable(shown) ? { track: shown, road: s.road } : null;
      if (!finishB) finishB = (await branches.current?.played) ?? null;
      if (!finishB) finishB = await fetchBranch(advance(s, "played"));
      if (!finishB?.track.spotify_id || !isPlayable(finishB.track)) {
        swapping.current = ""; // let the next check try again
        return;
      }
      const afterState = { ...advance(s, "played"), current: finishB.track, road: finishB.road };
      const skipB = await Promise.race([
        fetchBranch(advance(afterState, "skipped")),
        new Promise<Branch>((res) => setTimeout(() => res(null), Math.max(0, deadline - Date.now() - 4_000))),
      ]);
      let thenB: Branch = null;
      if (skipB?.track.spotify_id) {
        const onSkip = { ...advance(afterState, "skipped"), current: skipB.track, road: skipB.road };
        thenB = await Promise.race([
          fetchBranch(advance(onSkip, "skipped")),
          new Promise<Branch>((res) => setTimeout(() => res(null), Math.max(0, deadline - Date.now() - 3_000))),
        ]);
      }
      // Get close to the end, then re-read Spotify's real position so the swap lands
      // right as the song ends — not seconds early, and not after the skip door has started.
      let end = deadline;
      await new Promise((res) => setTimeout(res, Math.max(0, end - Date.now() - 2_500)));
      try {
        const st = await playbackFn();
        if (st.status === "ready" && st.spotifyId === cur.spotify_id && st.durationMs) {
          end = Date.now() + Math.max(0, st.durationMs - st.progressMs);
        }
      } catch {
        /* keep the estimate */
      }
      // Fire a beat before the last millisecond: the round-trip to Spotify takes time, and
      // sending while the track is in its final moments makes Spotify skip straight past the
      // first song in the list. The final ~1 s of a track is almost always silence/fade.
      await new Promise((res) => setTimeout(res, Math.max(0, end - Date.now() - 1_100)));
      const now = radioRef.current;
      if (now.sessionId !== s.sessionId || now.current?.spotify_id !== cur.spotify_id) {
        if (swapping.current === cur.spotify_id) swapping.current = "";
        return; // you moved on yourself
      }
      // Tell Spotify first; only move Crate forward once Spotify actually took the finish pick.
      // Send the finish pick AND its "if you skip" door in the same call, so nothing has to be
      // re-sent while the new song plays (a mid-song re-send makes Spotify re-buffer audibly).
      noPlayFor.current = finishB.track.spotify_id;
      committing.current = true;
      let ok = false;
      try {
        ok = await startSpotifyPlayback(
          finishB.track, true,
          skipB?.track && isPlayable(skipB.track) ? skipB.track : null,
          undefined,
          thenB?.track && isPlayable(thenB.track) ? thenB.track : null,
        );
      } finally {
        committing.current = false;
      }


      if (!ok) {
        noPlayFor.current = "";
        swapping.current = "";
        note("think", `Couldn't hand "${finishB.track.name}" to Spotify in time — retrying`);
        return;
      }
      if (skipB) preSkip.current = { forId: finishB.track.spotify_id, branch: skipB };
      if (thenB && skipB?.track.spotify_id) preSkip2.current = { forId: skipB.track.spotify_id, branch: thenB };
      log(cur, "play_through", s);
      played.current.push(cur.spotify_id);
      branches.current = null;
      setRadio(afterState);
      noteMove(cur, "played", finishB.track, finishB.road);
      lastPlayback.current = {
        spotifyId: finishB.track.spotify_id, ratio: 0, observed: true,
        progressMs: 0, durationMs: 0, at: Date.now(),
      };
      lastTransition.current = Date.now();
      swapping.current = ""; // hand-over done — keep watching for your skips
    },
    [fetchBranch, log, note, startSpotifyPlayback, noteMove, playbackFn],
  );

  /** Skip spamming (many skips in a second): pause, warn, then restart clean. */
  const calmDown = useCallback(async () => {
    if (calmingRef.current || Date.now() < cooldownUntil.current) return;
    calmingRef.current = true;
    cooldownUntil.current = Date.now() + 60_000; // held until the clicking stops
    jumps.current = [];
    // Stop any song scouting that is running: nothing is picked while you keep clicking.
    scoutAbort.current?.abort();
    branches.current = null;
    door.current = null;
    lineup.current = [];
    void pauseFn().catch(() => undefined);
    setCalming(true);
    note("think", "Too many skips at once — pausing until the clicking stops, then weaving a fresh song");
    const s = radioRef.current;
    try {
      // Wait for 2 quiet seconds: every further skip (even while paused) restarts the wait.
      const started = Date.now();
      let quietSince = Date.now();
      let seen = "";
      try {
        const st = await playbackFn();
        seen = st.spotifyId ?? "";
      } catch {
        /* keep waiting anyway */
      }
      while (Date.now() - quietSince < 2_000 && Date.now() - started < 20_000) {
        await new Promise((res) => setTimeout(res, 400));
        if (radioRef.current.sessionId !== s.sessionId) return;
        try {
          const st = await playbackFn();
          const id = st.spotifyId ?? "";
          if (id && id !== seen) {
            seen = id;
            quietSince = Date.now(); // still clicking — keep waiting
            void pauseFn().catch(() => undefined);
          }
        } catch {
          /* ignore a hiccup and keep waiting */
        }
      }
      setCalming(false);
      const now = radioRef.current;
      if (now.sessionId !== s.sessionId || !now.current) return;
      // Only now does Crate look for the next song and build a clean line-up.
      const fresh =
        upSkipRef.current?.track ??
        reserves.current.tracks.find(isPlayable) ??
        (await fetchBranch(advance(now, "skipped")))?.track ??
        null;
      if (radioRef.current.sessionId !== s.sessionId) return;
      if (fresh?.spotify_id && isPlayable(fresh)) {
        noPlayFor.current = fresh.spotify_id;
        if (await startSpotifyPlayback(fresh, true, null)) {
          if (now.current.spotify_id) played.current.push(now.current.spotify_id);
          setRadio({ ...advance(now, "skipped"), current: fresh });
          note("pick", `Picking up again: "${fresh.name}" by ${fresh.artists}`);
        }
      }
    } finally {
      setCalming(false);
      calmingRef.current = false;
      cooldownUntil.current = Date.now() + 600;
    }
  }, [pauseFn, playbackFn, fetchBranch, startSpotifyPlayback, note]);

  // Spotify owns playback. While a session is live, mirror what Spotify plays —
  // skips, finishes and songs you pick yourself inside the Spotify app.
  useEffect(() => {
    if (!sessionLive || !radio.active || playbackIssue) return;
    const check = async () => {
      const current = radioRef.current.current;
      if (!current?.spotify_id || advancing.current || committing.current) return;
      if (Date.now() < cooldownUntil.current) return; // catching our breath
      try {
        const state = await playbackFn();
        const previous = lastPlayback.current;
        const playing = state.status === "ready" && state.isPlaying;
        if (!playing) {
          // Spotify reports no open device at all → Spotify is closed; end the session.
          if (state.status === "idle" || state.status === "no_device") {
            if (!noDeviceSince.current) noDeviceSince.current = Date.now();
            // Try to wake Spotify back up every 5 s instead of giving up right away.
            if (Date.now() - lastReconnectTry.current > 5_000) {
              lastReconnectTry.current = Date.now();
              void startSpotifyPlayback(
                current,
                true,
                null,
                lastPlayback.current.progressMs || undefined,
              );
            }
            if (Date.now() - noDeviceSince.current > NO_DEVICE_GRACE) {
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
          // Spotify ran off the end of Crate's list and looped back to the first song.
          if (previous.observed && previous.progressMs > state.progressMs + 8_000 && Date.now() - lastTransition.current > 3_000) {
            await calmDown();
            return;
          }
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
        // Song ran out naturally while the end hand-over is lined up — let it finish the job.
        if (swapping.current === current.spotify_id && previous.ratio >= 0.9) return;
        const sinceMove = Date.now() - lastTransition.current;
        const rapid = sinceMove < 15_000;
        // Not seen playing yet: only a rapid skip (after Spotify had time to start it) counts.
        if (!previous.observed && !(rapid && sinceMove > 2_500)) return;
        const outcome = previous.ratio >= 0.7 ? "played" : "skipped";
        if (state.status === "ready" && state.spotifyId) {
          // Where Spotify landed in Crate's list says how many songs you skipped past.
          const at = lineup.current.indexOf(current.spotify_id);
          const landed = lineup.current.indexOf(state.spotifyId);
          const steps = at >= 0 && landed > at ? landed - at : 0;
          jumps.current = [...jumps.current.filter((t) => Date.now() - t < 3_000), Date.now()];
          const bursts = jumps.current.length + Math.max(0, steps - 1);
          // Skipped past the whole chain (skip 1, 2 and 3): pause, warn, restart clean.
          if (bursts >= 4 || (landed < 0 && jumps.current.length >= 3)) {
            await calmDown();
            return;
          }
          const q = door.current;
          if (q && q.forId === current.spotify_id && q.track.spotify_id === state.spotifyId) {
            // you skipped onto Crate's "if you skip" door
            acceptObserved(q.track, outcome, false, state.progressMs, state.durationMs);
          } else if (steps >= 2) {
            // Two or three skips in a heartbeat: log them all, then turn to a new angle.
            const landedTrack: RadioTrack = {
              id: `demo-ext-${state.spotifyId}`,
              spotify_id: state.spotifyId,
              name: state.name || "Unknown song",
              artists: state.artists,
              album: state.album,
              image_url: state.imageUrl,
              spotify_url: state.spotifyUrl,
              source_name: "Spotify",
            };
            for (const id of lineup.current.slice(at + 1, landed)) {
              played.current.push(id);
              log({ name: "skipped door", artists: "" }, "early_skip", radioRef.current);
            }
            note("skip", `${steps} skips in a row → Crate turns to a new angle`);
            acceptObserved(landedTrack, "skipped", false, state.progressMs, state.durationMs);
            setRadio((s) => ({ ...s, consecutiveSkips: Math.max(2, steps), road: "mixed" }));
            setAskSteer(true);
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
        if (state.status === "idle" || (state.status === "ready" && !state.spotifyId)) {
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
      timer = setTimeout(() => void loop(), fast ? 800 : 1_000);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionLive, radio.active, radio.sessionId, playbackIssue, playbackFn, next, acceptObserved, stopRadio, handOver, startSpotifyPlayback, calmDown, log, note]);

  // "Open Spotify" issue: retry reconnecting every 5 s; only give up after ~5 min.
  useEffect(() => {
    if (!sessionLive || playbackIssue?.status !== "no_device") return;
    const started = Date.now();
    const t = setInterval(() => {
      const current = radioRef.current.current;
      if (current?.spotify_id) {
        void startSpotifyPlayback(current, true, null, lastPlayback.current.progressMs || undefined);
      }
      if (Date.now() - started > NO_DEVICE_GRACE) stopRadio({ keepSpotify: true });
    }, 5_000);
    return () => clearInterval(t);
  }, [sessionLive, playbackIssue, stopRadio, startSpotifyPlayback]);

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
      if (s.active) note("steer", `${on ? "You steered toward" : "You dropped"} "${chip}" → re-scouting both doors`);
      setRadio({ ...s, chips });
    },
    [log, note],
  );

  /** One entry point for side roads (lenses + deep cuts). Toggling back within 10s restores the old doors. */
  const applySideRoad = useCallback(
    (nextLens: LensId | null, nextDeep: boolean) => {
      const s = radioRef.current;
      const prevLens = lensRef.current;
      const prevDeep = deepCutsRef.current;
      if (prevLens === nextLens && prevDeep === nextDeep) return;
      const snap = sideSnap.current;
      const canRestore =
        s.active && snap && Date.now() - snap.at < 10_000 && snap.currentId === s.current?.spotify_id &&
        snap.lens === nextLens && snap.deep === nextDeep && snap.historyLen === s.history.length;
      // Remember the doors we are leaving, unless we're already inside a revert window.
      if (s.active && !(snap && Date.now() - snap.at < 10_000 && snap.currentId === s.current?.spotify_id)) {
        sideSnap.current = {
          at: Date.now(), lens: prevLens, deep: prevDeep, currentId: s.current?.spotify_id,
          historyLen: s.history.length, branches: branches.current,
          upNext: upNextRef.current, upSkip: upSkipRef.current,
          preSkip: preSkip.current, preSkip2: preSkip2.current,
        };
      }
      lensRef.current = nextLens;
      setLensState(nextLens);
      deepCutsRef.current = nextDeep;
      setDeepCutsState(nextDeep);
      if (lensTimer.current) clearTimeout(lensTimer.current);
      scoutAbort.current?.abort();
      if (canRestore && snap) {
        sideSnap.current = null;
        branches.current = snap.branches;
        preSkip.current = snap.preSkip;
        preSkip2.current = snap.preSkip2;
        setUpNext(snap.upNext);
        setUpSkip(snap.upSkip);
        note("steer", "Side road toggled back → keeping the original doors");
        return;
      }
      if (s.active && nextLens) log({ name: `lens:${nextLens}`, artists: "" }, "steer", s);
      if (s.active && nextDeep) log({ name: "deep cuts", artists: "" }, "steer", s);
      branches.current = null;
      preSkip.current = null;
      preSkip2.current = null;
      if (!s.active) return;
      setUpNext(null);
      setUpSkip(null);
      const label = nextLens ?? (nextDeep ? "deep cuts" : null);
      note("steer", label ? `Side road ${label} on → re-scouting both doors` : "Side road off → back to the main roads");
      lensTimer.current = setTimeout(() => {
        lensTimer.current = null;
        setRadio({ ...radioRef.current });
      }, 350);
    },
    [log, note],
  );

  const setLens = useCallback((next: LensId | null) => applySideRoad(next, false), [applySideRoad]);
  const setDeepCuts = useCallback(
    (enabled: boolean) => applySideRoad(enabled ? null : lensRef.current, enabled),
    [applySideRoad],
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
        deepCuts,
        setDeepCuts,
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
      {calming && (
        <div
          role="status"
          aria-live="assertive"
          className="pointer-events-none fixed left-1/2 top-6 z-[100] -translate-x-1/2 animate-in fade-in slide-in-from-top-2 rounded-2xl border border-border bg-popover px-5 py-3 text-center shadow-2xl"
        >
          <p className="text-sm font-bold text-popover-foreground">Cool your jets</p>
          <p className="text-xs text-muted-foreground">Crate needs a moment to catch his breath.</p>
        </div>
      )}
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
