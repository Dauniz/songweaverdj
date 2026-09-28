import { LIVE_KEY, readLiveSession } from "@/lib/live-session";

const LAST_KEY = "songweaver-last-session";
/** End the session when Spotify shows no open device for this long. */
const NO_DEVICE_GRACE = 90_000;
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { logListeningEvent } from "@/lib/radio.functions";
import { nextPathTrack } from "@/lib/path.functions";
import { synthesizeMemories } from "@/lib/taste-synthesis.functions";
import { LENS_IDS, type LensId } from "@/lib/lenses";
import { pushSpotifyLog, ackSpotifySend, observeSpotify } from "@/lib/spotify-log";
import { endSpotifySession, getSpotifyAuthUrl, getSpotifyPlayback, pauseSpotifyPlayback, playSpotifyTrack } from "@/lib/spotify.functions";
import { openSpotifyAuth, usePreparedSpotifyUrl } from "@/lib/spotify-open";
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
  /** Skip-spam cooldown: Spotify paused, Crate catching its breath. */
  calming: boolean;
  foreignQueued: number;
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

/** What to send the moment you land on the LAST song Spotify has lined up (the frontier):
 *  that song's own "if you skip" door, and that door's skip. Chosen while the song before it
 *  plays, so the list goes out at ~0:00 of the frontier song instead of mid-song. */
type LandingPlan = {
  forId: string;
  sessionId: string;
  door: Promise<Branch>;
  ahead: Promise<Branch>;
  /** undefined while still being chosen, null when nothing fit. */
  doorVal: Branch | undefined;
  aheadVal: Branch | undefined;
};

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}

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
  const synthFn = useServerFn(synthesizeMemories);
  /** Songs logged this run — Crate reflects every few of them. */
  const logged = useRef(0);
  const reflecting = useRef(false);
  const playFn = useServerFn(playSpotifyTrack);
  const pauseFn = useServerFn(pauseSpotifyPlayback);
  const playbackFn = useServerFn(getSpotifyPlayback);
  const authUrlFn = useServerFn(getSpotifyAuthUrl);
  const qc = useQueryClient();
  const [playbackIssue, setPlaybackIssue] = useState<SpotifyPlaybackIssue | null>(null);
  const lastLostPrompt = useRef(0);
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
  const startingFor = useRef<{ id: string; at: number } | null>(null);
  const watchOff = useRef(false);
  // Track Spotify is already playing (user-chosen in Spotify) — don't restart it.
  const noPlayFor = useRef("");
  // The single song lined up behind the current one in Spotify (the "if you skip" door).
  const door = useRef<{ forId: string; track: RadioTrack } | null>(null);
  // "If you skip" door for the upcoming song, computed before the hand-over near the end.
  const preSkip = useRef<{ forId: string; branch: Branch } | null>(null);
  const scoutAbort = useRef<AbortController | null>(null);
  const lensTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upSkipRef = useRef<{ track: RadioTrack; road: Road } | null>(null);
  upSkipRef.current = upSkip;
  const sideSnap = useRef<{
    at: number; lens: LensId | null; deep: boolean; currentId: string | null | undefined; historyLen: number;
    branches: { key: string; played: Promise<Branch>; skipped: Promise<Branch> } | null;
    upNext: RadioTrack | null; upSkip: { track: RadioTrack; road: Road } | null;
    preSkip: { forId: string; branch: Branch } | null;
    plan: LandingPlan | null;
  } | null>(null);
  const swapping = useRef("");
  /** Song ids last sent to Spotify, in order — lets Crate skip re-sending when the next door is already lined up. */
  const lineup = useRef<string[]>([]);
  /** Full song info for everything in `lineup`, so a skip onto any of them is followed exactly. */
  const lineupTracks = useRef<Map<string, RadioTrack>>(new Map());
  /** Monotonic Spotify list generation; stale scouting and replies cannot overwrite newer state. */
  const listGeneration = useRef(0);
  const acceptedGeneration = useRef(0);
  const playbackWrite = useRef<Promise<void>>(Promise.resolve());
  /** True after the first skip until that song's new authoritative pair is accepted. */
  const awaitingSkipPair = useRef(false);
  /** Skip landed on a door whose own skip song was already queued: another change before this
   *  moment is a rapid double skip; after it, a skip onto the queued skip-ahead is allowed. */
  const quickSkipUntil = useRef(0);
  /** Always one step ahead of the last song Spotify has: see `LandingPlan`. */
  const landingPlan = useRef<LandingPlan | null>(null);
  /** Bumped when a landing send fails, so the line-up guard below re-sends. */
  const [resendTick, setResendTick] = useState(0);
  /** After a song change Crate waits one quiet second before scouting, in case you skip again. */
  const settleUntil = useRef(0);
  const [settleTick, setSettleTick] = useState(0);
  /** While set, Crate stops reacting to Spotify: the listener is being asked to slow down. */
  const cooldownUntil = useRef(0);
  const calmingRef = useRef(false);
  // When Crate last moved to a new song — rapid skips right after this are followed, not re-rooted.
  const lastTransition = useRef(0);
  const idleSince = useRef(0);
  // Require several fresh, visible-tab snapshots before calling Spotify idle.
  // A single stale `is_playing: false` response is common around device/track handovers.
  const idlePolls = useRef(0);
  const [events, setEvents] = useState<MazeEvent[]>([]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [spotifyIdle, setSpotifyIdle] = useState(false);
  const [calming, setCalming] = useState(false);
  /** Songs in the listener's own Spotify "Next in queue" — they'd play before Crate's list. */
  const [foreignQueued, setForeignQueued] = useState(0);
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

  /** Let Crate reflect on how this session was actually listened to. */
  const reflect = useCallback(
    (sessionId: string, requested: "session" | "history") => {
      if (reflecting.current) return;
      // The big cross-session pass reads up to 600 events; patterns across sessions
      // don't change minute to minute, so run it at most every 12 h per device.
      let scope = requested;
      if (scope === "history") {
        const last = Number(localStorage.getItem("sw-history-reflect-at") ?? 0);
        if (Date.now() - last < 12 * 3600_000) scope = "session";
        else localStorage.setItem("sw-history-reflect-at", String(Date.now()));
      }
      reflecting.current = true;
      synthFn({ data: { sessionId: sessionId || null, scope, tzOffsetMin: new Date().getTimezoneOffset() } })
        .then((r) => {
          if (r?.saved) {
            qc.invalidateQueries({ queryKey: ["memories"] });
            for (const i of r.insights ?? []) note("pick", `Walrus memory written: ${i.content}`);
          }
        })
        .catch(() => null)
        .finally(() => {
          reflecting.current = false;
        });
    },
    [synthFn, qc, note],
  );

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
      // Every few songs Crate steps back and draws conclusions from the trace.
      logged.current += 1;
      if (logged.current % 10 === 0 && s.sessionId) reflect(s.sessionId, logged.current >= 30 ? "history" : "session");
    },
    [logFn, qc, reflect],
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
            tzOffsetMin: new Date().getTimezoneOffset(),
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
      const cid = s.current.spotify_id;
      // The skip door may already be decided: queued in Spotify behind this song (preSkip), or
      // being chosen one step ahead (the landing plan). Reuse it — scouting again would put a
      // different song on screen than the one Spotify will really play.
      const ps = preSkip.current;
      const pre = ps && ps.forId === cid ? ps.branch : null;
      const lp = landingPlan.current;
      const plan = !pre && lp && lp.forId === cid && lp.sessionId === s.sessionId ? lp : null;
      const knownSkipId = pre?.track.spotify_id ?? plan?.doorVal?.track.spotify_id;
      const playedB = fetchBranch(advance(s, "played"), ctrl.signal, knownSkipId ? [knownSkipId] : []);
      const skippedState = advance(s, "skipped");
      // Fresh scout, in parallel with the finish door: the two must never be the same song.
      const freshSkip = () =>
        Promise.all([playedB, fetchBranch(skippedState, ctrl.signal)]).then(([finish, first]) => {
          const finishId = finish?.track.spotify_id;
          if (first && finishId && first.track.spotify_id === finishId) return fetchBranch(skippedState, ctrl.signal, [finishId]);
          return first;
        });
      const skippedB: Promise<Branch> = pre
        ? Promise.resolve(pre)
        : plan
          ? plan.door.then((b) => (b?.track && isPlayable(b.track) ? b : freshSkip()))
          : freshSkip();
      branches.current = { key, played: playedB, skipped: skippedB };
      if (plan && !knownSkipId) {
        // The planned door arrives later: if it turns out to be the finish pick, re-choose the finish.
        void Promise.all([playedB, skippedB]).then(([finish, skip]) => {
          if (branches.current?.key !== key || !finish || !skip || finish.track.spotify_id !== skip.track.spotify_id) return;
          const again = fetchBranch(advance(s, "played"), ctrl.signal, [skip.track.spotify_id!]);
          branches.current = { key, played: again, skipped: skippedB };
          void again.then((b) => {
            if (branches.current?.key === key) setUpNext(b?.track ?? null);
          });
        });
      }
      setUpNext(null);
      if (!pre) setUpSkip(null);
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
    // One quiet second after a song change: if you skip again, no search is wasted.
    const wait = settleUntil.current - Date.now();
    if (wait > 0) {
      const t = setTimeout(() => setSettleTick((n) => n + 1), wait + 50);
      return () => clearTimeout(t);
    }
    prefetch(radio);
    return undefined;
  }, [radio, prefetch, settleTick]);

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
    // Closing thought: what did this session reveal about their taste?
    if (s.sessionId && logged.current > 0) reflect(s.sessionId, "history");
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
    landingPlan.current = null;
    lineup.current = [];
    lineupTracks.current = new Map();
    listGeneration.current += 1;
    awaitingSkipPair.current = false;
    setSessionLive(false);
    setSpotifyIdle(false);
    setRadio(IDLE);
    localStorage.removeItem(LIVE_KEY);
    // Hand Spotify back clean: pause and drop the songs Crate had lined up.
    if (!opts?.keepSpotify) void endSpotifySession().catch(() => undefined);
  }, [reflect]);

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
      landingPlan.current = null;
      lineup.current = [];
      lineupTracks.current = new Map();
      listGeneration.current += 1;
      awaitingSkipPair.current = false;
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

  /** One step ahead: the "if you skip" door's own "if you skip" song. */
  const scoutAhead = useCallback(
    async (s: RadioState, skip: Branch, exclude: (string | undefined | null)[] = []): Promise<Branch> => {
      if (!skip?.track.spotify_id) return null;
      const onSkip = { ...advance(s, "skipped"), current: skip.track, road: skip.road };
      const b = await fetchBranch(advance(onSkip, "skipped"), undefined, [s.current?.spotify_id, ...exclude].filter(Boolean) as string[]);
      return b?.track.spotify_id && isPlayable(b.track) && b.track.spotify_id !== skip.track.spotify_id ? b : null;
    },
    [fetchBranch],
  );

  /** Start choosing what to send the moment you land on `frontier` — the last song Spotify has.
   *  `parent` is the state of the song right before it; `doorPromise` reuses a search already
   *  running for that door instead of asking Crate twice. The plan replaces any older one. */
  const planLanding = useCallback(
    (parent: RadioState, frontier: NonNullable<Branch>, exclude: (string | undefined | null)[] = [], doorPromise?: Promise<Branch>) => {
      const forId = frontier.track.spotify_id;
      if (!forId || !parent.current) return null;
      const ex = exclude.filter(Boolean) as string[];
      const door = withTimeout(doorPromise ?? scoutAhead(parent, frontier, ex), 15_000, null);
      const atFrontier: RadioState = { ...advance(parent, "skipped"), current: frontier.track, road: frontier.road };
      const ahead = door.then((d) => (d ? withTimeout(scoutAhead(atFrontier, d, [forId, ...ex]), 15_000, null) : null));
      const plan: LandingPlan = { forId, sessionId: parent.sessionId, door, ahead, doorVal: undefined, aheadVal: undefined };
      landingPlan.current = plan;
      void door.then((d) => {
        plan.doorVal = d;
        if (d && landingPlan.current === plan) note("door", `One step ahead: if you skip "${frontier.track.name}" too → "${d.track.name}"`);
      });
      void ahead.then((a) => {
        plan.aheadVal = a;
      });
      return plan;
    },
    [scoutAhead, note],
  );

  const startSpotifyPlayback = useCallback(
    async (
      track = radioRef.current.current,
      quiet = false,
      skipDoor?: RadioTrack | null,
      positionMs?: number,
      reason = "start",
      aheadDoor?: RadioTrack | null,
      opts?: { stateAt?: RadioState | undefined; frontierDoor?: Promise<Branch> | undefined },
    ) => {
      if (!track?.spotify_id || track.spotify_id.startsWith("demo-")) return false;
      const nextId = skipDoor?.spotify_id && isPlayable(skipDoor) ? skipDoor.spotify_id : undefined;
      if (!nextId || nextId === track.spotify_id) {
        if (!quiet) {
          setPlaybackIssue({
            status: "unavailable",
            message: "Crate couldn't prepare the skip track. Try starting the song again.",
          });
        }
        return false;
      }
      const aheadId =
        aheadDoor?.spotify_id && isPlayable(aheadDoor) && aheadDoor.spotify_id !== nextId && aheadDoor.spotify_id !== track.spotify_id
          ? aheadDoor.spotify_id
          : undefined;
      const generation = ++listGeneration.current;
      const priorWrite = playbackWrite.current;
      let releaseWrite: () => void = () => {};
      playbackWrite.current = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      await priorWrite;
      if (generation !== listGeneration.current) {
        releaseWrite();
        return false;
      }
      setRetrying(true);
      try {
        const logId = pushSpotifyLog({
          kind: "send",
          at: Date.now(),
          generation,
          reason,
          positionMs,
          uris: [
            { id: track.spotify_id, name: track.name },
            { id: nextId, name: skipDoor?.name ?? nextId },
            ...(aheadId ? [{ id: aheadId, name: aheadDoor?.name ?? aheadId }] : []),
          ],
        });
        const result = await playFn({ data: { spotifyId: track.spotify_id, nextId, aheadId, positionMs } }).catch((err) => {
          ackSpotifySend(logId, "error");
          throw err;
        });
        ackSpotifySend(logId, result.status);
        if (result.status === "playing" && generation === listGeneration.current) {
          acceptedGeneration.current = generation;
          lineup.current = aheadId ? [track.spotify_id, nextId, aheadId] : [track.spotify_id, nextId];
          const m = new Map<string, RadioTrack>();
          m.set(track.spotify_id, track);
          if (skipDoor) m.set(nextId, skipDoor);
          if (aheadId && aheadDoor) m.set(aheadId, aheadDoor);
          lineupTracks.current = m;
          quickSkipUntil.current = 0;
          setPlaybackIssue(null);
          setForeignQueued((result as { foreignQueued?: number }).foreignQueued ?? 0);
          idleSince.current = 0;
          idlePolls.current = 0;
          setSpotifyIdle(false);
          const stateAt = opts?.stateAt ?? radioRef.current;
          const skipRoad = stateAt.current ? advance(stateAt, "skipped").road : stateAt.road;
          if (skipDoor) {
            door.current = { forId: track.spotify_id, track: skipDoor };
            setUpSkip({ track: skipDoor, road: skipRoad });
          }
          // Always think one step ahead of the LAST song Spotify has. With a skip-ahead in the
          // list, its plan starts once you land on the skip door (no wasted searches if you let
          // this song finish). With only two songs, start choosing the skip door's own skip now,
          // so a skip onto it is answered at ~0:00 instead of mid-song.
          if (aheadId) {
            if (landingPlan.current?.forId !== aheadId) landingPlan.current = null;
          } else if (
            skipDoor && stateAt.current &&
            !(landingPlan.current?.forId === nextId && landingPlan.current.sessionId === stateAt.sessionId)
          ) {
            planLanding(stateAt, { track: skipDoor, road: skipRoad }, [track.spotify_id, upNextRef.current?.spotify_id], opts?.frontierDoor);
          }
          awaitingSkipPair.current = false;
          if (!positionMs) {
            lastTransition.current = Date.now();
            // The one-quiet-second rule is for SKIPS only. A fresh start you clicked gets it;
            // a finish hand-over (quiet) already carries its full line-up, so scouting for the
            // new song's finish door can start right away.
            if (!quiet) settleUntil.current = Date.now() + 1_000;
          }
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
        if (!quiet && result.status !== "playing") setPlaybackIssue({ status: result.status, message: result.message });
        return false;
      } catch {
        if (!quiet) setPlaybackIssue({ status: "unavailable", message: "Spotify playback is temporarily unavailable." });
        return false;
      } finally {
        setRetrying(false);
        releaseWrite();
      }
    },
    [playFn, planLanding],
  );

  useEffect(() => {
    const current = radio.current;
    // Crate only touches Spotify playback while a session is live.
    if (!sessionLive || !radio.active || !current?.spotify_id || current.spotify_id.startsWith("demo-")) return;
    if (calmingRef.current) return;
    if (noPlayFor.current === current.spotify_id) {
      noPlayFor.current = "";
      return; // Spotify is already playing it
    }
    const startId = current.spotify_id;
    startingFor.current = { id: startId, at: Date.now() };
    const release = () => {
      if (startingFor.current?.id === startId) startingFor.current = null;
    };
    const ready = preSkip.current?.forId === current.spotify_id ? preSkip.current!.branch : null;
    let cancelled = false;
    void (async () => {
      let branch: Branch = ready?.track && isPlayable(ready.track) ? ready : null;
      if (!branch) {
        const prefix = `${current.id}|`;
        for (let i = 0; i < 20 && !branches.current?.key.startsWith(prefix); i++) {
          await new Promise((res) => setTimeout(res, 100));
          if (cancelled) return;
        }
        const b = branches.current?.key.startsWith(prefix) ? branches.current : null;
        branch = await Promise.race([
          (b ? b.skipped : fetchBranch(advance(radioRef.current, "skipped"))).catch(() => null),
          new Promise<Branch>((res) => setTimeout(() => res(null), 10_000)),
        ]);
      }
      if (cancelled || radioRef.current.current?.spotify_id !== current.spotify_id) return;
      const skip = branch?.track && isPlayable(branch.track) && branch.track.spotify_id !== current.spotify_id ? branch : null;
      if (skip) setUpSkip(skip);
      const finishId = upNextRef.current?.spotify_id;
      const aheadP: Promise<Branch> = skip ? scoutAhead(radioRef.current, skip, [finishId]) : Promise.resolve(null);
      const ahead = await withTimeout(aheadP, 6_000, null);
      if (cancelled || radioRef.current.current?.spotify_id !== current.spotify_id) return;
      await startSpotifyPlayback(current, false, skip?.track ?? null, undefined, "session start", ahead?.track ?? null, {
        frontierDoor: ahead ? undefined : aheadP,
      });
      // Give Spotify a moment to report the new song before the mirror resumes.
      lastPlayback.current = { spotifyId: startId, ratio: 0, observed: false, progressMs: 0, durationMs: 0, at: Date.now() };
      setTimeout(release, 1_500);
    })();
    return () => {
      cancelled = true;
      release();
    };
  }, [sessionLive, radio.active, radio.current?.spotify_id, startSpotifyPlayback, fetchBranch, scoutAhead]);


  /** You landed on the last song Spotify had lined up. Send its prepared pair right away, at
   *  ~0:00 of the song — the one moment a re-send is barely audible. */
  const landOnFrontier = useCallback(
    async (track: RadioTrack, landed: RadioState, plan: LandingPlan, progressMs: number) => {
      const tid = track.spotify_id ?? "";
      const observedAt = Date.now();
      // React may not have re-rendered yet, so judge "still on this song" by the last observation.
      const still = () =>
        lastPlayback.current.spotifyId === tid && !calmingRef.current && radioRef.current.sessionId === plan.sessionId;
      const d = await plan.door;
      if (!still()) return;
      if (!d?.track.spotify_id) {
        pushSpotifyLog({ kind: "event", at: Date.now(), text: `LANDING — no skip song ready for "${track.name}", scouting now (one mid-song resend)` });
        return; // the line-up guard re-sends once a fresh door is found
      }
      // Take the skip-ahead only when it's already known — never hold the send for it.
      const a = plan.aheadVal ?? null;
      door.current = { forId: tid, track: d.track }; // claim the line-up so the guard doesn't double-send
      preSkip.current = { forId: tid, branch: d };
      setUpSkip(d);
      const ok = await startSpotifyPlayback(
        track, true, d.track,
        Math.max(1, Math.round(progressMs + (Date.now() - observedAt) + 150)),
        "landing-resend", a?.track ?? null,
        { stateAt: landed, frontierDoor: a ? undefined : plan.ahead },
      );
      if (!ok && still()) {
        door.current = null;
        awaitingSkipPair.current = true;
        setResendTick((n) => n + 1); // let the line-up guard try again
      }
    },
    [startSpotifyPlayback],
  );

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
      listGeneration.current += 1;
      scoutAbort.current?.abort();
      awaitingSkipPair.current = false;
      noPlayFor.current = track.spotify_id ?? "";
      lastTransition.current = Date.now();
      settleUntil.current = Date.now() + 1_000; // one quiet second before Crate looks for new songs
      lastPlayback.current = { spotifyId: track.spotify_id ?? "", ratio: 0, observed: true, progressMs, durationMs, at: Date.now() };
      door.current = null;
      branches.current = null;
      if (reroot) note("reroot", `You played "${track.name}" in Spotify → new starting point`);
      else noteMove(s.current, outcome, track, nextState.road);
      const landedState: RadioState = reroot
        ? { ...nextState, current: track, seed: track, consecutiveSkips: 0 }
        : { ...nextState, current: track };
      const tid = track.spotify_id ?? "";
      const plan = landingPlan.current;
      if (reroot) {
        // Spotify is playing something Crate never sent (your own pick): its old list is gone.
        // Crate chooses a skip door for it and sends once mid-song — the one accepted glitch.
        lineup.current = [];
        lineupTracks.current = new Map();
        landingPlan.current = null;
        preSkip.current = null;
        quickSkipUntil.current = 0;
        setUpSkip(null); // the old door was chosen for another song — decide a fresh one first
        pushSpotifyLog({ kind: "event", at: Date.now(), text: `MANUAL — "${track.name}" picked in Spotify; Crate will line up a skip song (one resend)` });
      } else if (tid) {
        const at = lineup.current.indexOf(tid);
        const aheadTrack = at >= 0 ? lineupTracks.current.get(lineup.current[at + 1] ?? "") : undefined;
        const skipRoad = advance(landedState, "skipped").road;
        if (aheadTrack?.spotify_id) {
          // The next song is already lined up behind this one in Spotify: nothing to resend.
          quickSkipUntil.current = Date.now() + 1_000;
          const aheadB: NonNullable<Branch> = { track: aheadTrack, road: skipRoad };
          door.current = { forId: tid, track: aheadTrack };
          preSkip.current = { forId: tid, branch: aheadB };
          setUpSkip(aheadB);
          if (plan?.forId !== aheadTrack.spotify_id) landingPlan.current = null;
          pushSpotifyLog({ kind: "event", at: Date.now(), text: `SKIP-AHEAD — "${aheadTrack.name}" already queued, no resend` });
          // After the quiet second, choose what to send if you skip onto that one too.
          const sessionId = s.sessionId;
          setTimeout(() => {
            const still = radioRef.current.sessionId === sessionId && radioRef.current.current?.spotify_id === tid && !calmingRef.current;
            if (!still || landingPlan.current?.forId === aheadTrack.spotify_id) return;
            planLanding(radioRef.current, aheadB, [upNextRef.current?.spotify_id]);
          }, 1_050);
        } else {
          // Landed on the last song Spotify had: nothing plays after it until Crate sends.
          awaitingSkipPair.current = true;
          quickSkipUntil.current = Date.now() + 1_000;
          setUpSkip(null); // this song WAS the skip door; its own door is shown once decided
          if (plan && plan.forId === tid && plan.sessionId === s.sessionId) {
            void landOnFrontier(track, landedState, plan, progressMs);
          } else {
            landingPlan.current = null;
            pushSpotifyLog({ kind: "event", at: Date.now(), text: `LANDING — nothing prepared for "${track.name}", scouting now (one mid-song resend)` });
          }
        }
      }
      setRadio(landedState);
    },
    [log, note, noteMove, planLanding, landOnFrontier],
  );

  // Line up exactly one song behind the current one: the "if you skip" door.
  // Spotify then lands on it if you skip; near the end Crate swaps in the "if you finish" pick.
  useEffect(() => {
    const cur = radio.current;
    const skip = upSkip?.track;
    if (!sessionLive || !cur?.spotify_id || !skip?.spotify_id || !isPlayable(skip) || skip.spotify_id === cur.spotify_id) return;
    if (calmingRef.current) return; // hands off Spotify while Crate waits out the clicking
    if (door.current?.forId === cur.spotify_id && door.current.track.spotify_id === skip.spotify_id) return;
    if (lastPlayback.current.spotifyId !== cur.spotify_id) return;
    // Already lined up behind this song in Spotify (sent one step ahead) — no re-send, no glitch.
    const at = lineup.current.indexOf(cur.spotify_id);
    if (at >= 0 && lineup.current[at + 1] === skip.spotify_id) {
      door.current = { forId: cur.spotify_id, track: skip };
      return;
    }
    let cancelled = false;
    void (async () => {
      // Send the new authoritative pair the moment the skip door is ready.
      if (cancelled || radioRef.current.current?.spotify_id !== cur.spotify_id) return;
      if (swapping.current === cur.spotify_id) return; // end-of-song hand-over owns the line-up now
      // Read Spotify's exact position right before sending so the resume point is seamless:
      // one single call, early in the song, starting at the precise millisecond.
      let pos: number | null = null;
      try {
        const t0 = Date.now();
        const st = await playbackFn();
        if (st.status === "ready" && st.spotifyId === cur.spotify_id) {
          pos = st.progressMs + Math.round((Date.now() - t0) / 2) + 150;
        }
      } catch {
        /* fall back to estimate */
      }
      if (cancelled || radioRef.current.current?.spotify_id !== cur.spotify_id || swapping.current === cur.spotify_id) return;
      if (pos === null) {
        const lp = lastPlayback.current;
        pos = Math.max(0, lp.progressMs + (Date.now() - lp.at));
      }
      // Never fall back to the old queued songs: Spotify's "Next up" must mirror the screen.
      noPlayFor.current = "";
      // If this door came from the landing plan, its own skip may already be known — send it too,
      // or let that running search become the plan for the new last song.
      const plan = landingPlan.current;
      const planned = plan && plan.forId === cur.spotify_id && plan.doorVal?.track.spotify_id === skip.spotify_id ? plan : null;
      const aheadKnown = planned?.aheadVal ?? null;
      const ok = await startSpotifyPlayback(cur, true, skip, Math.max(1, Math.round(pos)), "skip rebuild", aheadKnown?.track ?? null, {
        frontierDoor: planned && !aheadKnown ? planned.ahead : undefined,
      });
      const curId = cur.spotify_id;
      if (!ok && curId && !cancelled && radioRef.current.current?.spotify_id === curId) {
        // Spotify didn't take the new list: show the song it will really play on a skip.
        const i = lineup.current.indexOf(curId);
        const queued = i >= 0 ? lineupTracks.current.get(lineup.current[i + 1] ?? "") : undefined;
        if (queued) {
          door.current = { forId: curId, track: queued };
          setUpSkip({ track: queued, road: advance(radioRef.current, "skipped").road });
          pushSpotifyLog({ kind: "event", at: Date.now(), text: `Resend failed — screen reverted to Spotify's queued "${queued.name}"` });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionLive, radio.current, upSkip, resendTick, startSpotifyPlayback, playbackFn, fetchBranch]);

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
      const skipB = await withTimeout(fetchBranch(advance(afterState, "skipped")), Math.max(0, deadline - Date.now() - 4_000), null);
      // One step ahead: the finish song's skip door gets its own skip song in the same list.
      // If it isn't ready in time, that same search continues as the landing plan for the door.
      const aheadP: Promise<Branch> = skipB?.track && isPlayable(skipB.track)
        ? scoutAhead(afterState, skipB, [cur.spotify_id])
        : Promise.resolve(null);
      const aheadB = await withTimeout(aheadP, Math.max(0, deadline - Date.now() - 3_000), null);
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
          "finish handover",
          aheadB?.track ?? null,
          { stateAt: afterState, frontierDoor: aheadB ? undefined : aheadP },
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
      // The finish song starts with its skip door ALREADY queued in Spotify (sent in the
      // hand-over call). Point the screen and the door guard at that exact song right away —
      // otherwise the previous song's stale skip door triggers a mid-song re-send (the glitch).
      if (skipB?.track.spotify_id) {
        door.current = { forId: finishB.track.spotify_id, track: skipB.track };
        setUpSkip(skipB);
      } else {
        setUpSkip(null);
      }
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
    [fetchBranch, log, note, startSpotifyPlayback, noteMove, playbackFn, scoutAhead],
  );

  /** A second skip before the first skip's new pair is accepted: pause and rebuild cleanly. */
  const calmDown = useCallback(async () => {
    if (calmingRef.current || Date.now() < cooldownUntil.current) return;
    calmingRef.current = true;
    cooldownUntil.current = Date.now() + 60_000; // held until the clicking stops
    const prior = landingPlan.current; // a plan for the song we stopped on can be reused
    listGeneration.current += 1;
    scoutAbort.current?.abort();
    branches.current = null;
    door.current = null;
    landingPlan.current = null;
    quickSkipUntil.current = 0;
    lineup.current = [];
    lineupTracks.current = new Map();
    await pauseFn().catch(() => undefined);
    pushSpotifyLog({ kind: "event", at: Date.now(), text: "PAUSE — second rapid skip, Crate catching its breath" });
    setCalming(true);
    note("think", "A second quick skip — pausing while Crate rebuilds one clean path");
    const s = radioRef.current;
    try {
      await new Promise((res) => setTimeout(res, 1_000));
      const now = radioRef.current;
      if (now.sessionId !== s.sessionId || !now.current) return;
      const fresh = now.current;
      const planned = prior && prior.forId === fresh.spotify_id && prior.sessionId === now.sessionId
        ? await withTimeout(prior.door, 3_000, null)
        : null;
      const doorB = planned ?? (await withTimeout(fetchBranch(advance(now, "skipped")), 8_000, null));
      if (!doorB?.track.spotify_id || radioRef.current.sessionId !== s.sessionId) return;
      calmingRef.current = false;
      const aheadP = scoutAhead(now, doorB, []);
      const aheadB = await withTimeout(aheadP, 5_000, null);
      if (radioRef.current.sessionId !== s.sessionId) return;
      // The skip door is decided here: the re-scout after resume must reuse it, not replace it
      // (a different pick on screen would trigger another re-send a few seconds in).
      preSkip.current = { forId: fresh.spotify_id ?? "", branch: doorB };
      if (
        await startSpotifyPlayback(fresh, true, doorB.track, undefined, "cooldown resume", aheadB?.track ?? null, {
          stateAt: now,
          frontierDoor: aheadB ? undefined : aheadP,
        })
      ) {
        setUpSkip(doorB);
        awaitingSkipPair.current = false;
        pushSpotifyLog({ kind: "event", at: Date.now(), text: `RESUME — rebuilt from "${fresh.name}"` });
        note("pick", `Picking up again from "${fresh.name}" by ${fresh.artists}`);
        setRadio({ ...radioRef.current });
      }
    } finally {
      setCalming(false);
      calmingRef.current = false;
      cooldownUntil.current = Date.now() + 600;
    }
  }, [pauseFn, fetchBranch, startSpotifyPlayback, note, scoutAhead]);

  // Spotify owns playback. While a session is live, mirror what Spotify plays —
  // skips, finishes and songs you pick yourself inside the Spotify app.
  useEffect(() => {
    if (!sessionLive || !radio.active || playbackIssue) return;
    const check = async () => {
      const current = radioRef.current.current;
      if (!current?.spotify_id || advancing.current || committing.current) return;
      if (Date.now() < cooldownUntil.current) return; // catching our breath
      // First list for this song not sent yet: Spotify still reports the old/paused song.
      // Reading it now would reroot or end the session and wipe the picked song.
      const st = startingFor.current;
      if (st && st.id === current.spotify_id && Date.now() - st.at < 25_000) return;
      // Polling is throttled while Spotify is foregrounded on mobile. Ignore those stale
      // snapshots and require a fresh observation after Songweaver becomes visible again.
      if (document.hidden) {
        idleSince.current = 0;
        idlePolls.current = 0;
        return;
      }
      try {
        const state = await playbackFn();
        if (state.status === "ready") {
          observeSpotify(state.spotifyId, [state.name, state.artists].filter(Boolean).join(" — ") || state.spotifyId || "", state.progressMs, state.isPlaying);
        }
        // The request may have started just before Crate began a hand-over or deliberate
        // skip-spam pause. Discard that now-stale response instead of surfacing it as idle.
        if (calmingRef.current || committing.current || swapping.current) {
          idleSince.current = 0;
          idlePolls.current = 0;
          return;
        }
        const previous = lastPlayback.current;
        // Spotify occasionally reports `is_playing: false` while progress is still moving.
        // Treat advancing progress as authoritative so a transient API snapshot never raises
        // the warning over music that is audibly playing.
        const progressMoved =
          state.status === "ready" &&
          state.spotifyId === previous.spotifyId &&
          state.progressMs > previous.progressMs + 250;
        const playing = state.status === "ready" && (state.isPlaying || progressMoved);
        if (!playing) {
          // A second skip runs the two-song context dry. Spotify commonly reports the skip
          // door paused at its beginning; stop and rebuild rather than guessing another song.
          const skipId = lineup.current[lineup.current.length - 1];
          if (
            awaitingSkipPair.current && state.status === "ready" && skipId &&
            state.spotifyId === skipId && state.progressMs < 3_000
          ) {
            await calmDown();
            return;
          }
          // Connection/API failures are not proof that playback stopped. Keep the last known
          // live state and let the next poll recover instead of showing a misleading warning.
          if (state.status !== "ready" && state.status !== "idle" && state.status !== "no_device") return;
          // Spotify reports no open device at all → Spotify is closed; end the session.
          if (state.status === "idle" || state.status === "no_device") {
            if (!noDeviceSince.current) noDeviceSince.current = Date.now();
            // Spotify closed: show the "Open Spotify" message so the user can reopen it.
            // The retry effect below keeps reconnecting and ends the session after the grace.
            if (
              (state.status === "no_device" || Date.now() - noDeviceSince.current > 6_000) &&
              Date.now() - lastLostPrompt.current > 20_000 &&
              Date.now() - noDeviceSince.current <= NO_DEVICE_GRACE
            ) {
              lastLostPrompt.current = Date.now();
              setPlaybackIssue({ status: "no_device", message: "Spotify was closed. Open it again to keep the session going." });
              return;
            }
            if (Date.now() - lastReconnectTry.current > 5_000) {
              lastReconnectTry.current = Date.now();
              void startSpotifyPlayback(
                current,
                true,
                door.current?.forId === current.spotify_id ? door.current.track : null,
                lastPlayback.current.progressMs || undefined,
                "device reconnect",
              );
            }
            if (Date.now() - noDeviceSince.current > NO_DEVICE_GRACE) {
              noDeviceSince.current = 0;
              stopRadio({ keepSpotify: true });
              return;
            }
          } else noDeviceSince.current = 0;
          if (!idleSince.current) idleSince.current = Date.now();
          idlePolls.current += 1;
          if (idlePolls.current >= 5 && Date.now() - idleSince.current > 15_000) setSpotifyIdle(true);
          if (Date.now() - idleSince.current > 30 * 60_000) {
            stopRadio(); // idle ~30 min: hand Spotify back
            return;
          }
          // A paused Spotify player still reports its last track id. Never interpret that
          // stale id as a skip: doing so makes Crate replace the line-up repeatedly while
          // nothing is actually playing in Spotify.
          return;
        } else {
          idleSince.current = 0;
          idlePolls.current = 0;
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
          const landed = lineup.current.indexOf(state.spotifyId);
          // Once the first skip has landed, any further change before its replacement pair is
          // accepted is the second rapid skip. Polling cannot safely infer deeper positions.
          const curAt = lineup.current.indexOf(current.spotify_id ?? "");
          if (
            state.spotifyId !== current.spotify_id &&
            (awaitingSkipPair.current || Date.now() < quickSkipUntil.current || (curAt >= 0 && landed > curAt + 1))
          ) {
            await calmDown();
            return;
          }
          const q = door.current;
          if (q && q.forId === current.spotify_id && q.track.spotify_id === state.spotifyId) {
            // you skipped onto Crate's "if you skip" door
            acceptObserved(q.track, outcome, false, state.progressMs, state.durationMs);
          } else if (landed >= 0 && lineupTracks.current.get(state.spotifyId)) {
            // Landed on a song Crate itself queued: follow exactly that song — never swap in
            // a different pick, or Spotify and the screen drift apart.
            acceptObserved(lineupTracks.current.get(state.spotifyId)!, outcome, false, state.progressMs, state.durationMs);
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
        if (state.status === "ready" && !state.spotifyId) {
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

  /** Turn what Spotify is playing into the session seed without restarting it. */
  const adoptPlaying = useCallback(
    (state: { spotifyId?: string | null; name?: string | null; artists?: string; album?: string | null; imageUrl?: string | null; spotifyUrl?: string | null; progressMs: number; durationMs: number; isPlaying: boolean }) => {
      if (!state.spotifyId) return;
      const track: RadioTrack = {
        id: `demo-ext-${state.spotifyId}`,
        spotify_id: state.spotifyId,
        name: state.name || "Unknown song",
        artists: state.artists ?? "",
        album: state.album ?? null,
        image_url: state.imageUrl ?? null,
        spotify_url: state.spotifyUrl ?? null,
        source_name: "Spotify",
      } as RadioTrack;
      noPlayFor.current = state.isPlaying ? state.spotifyId : "";
      lastPlayback.current = {
        spotifyId: state.spotifyId, ratio: 0, observed: state.isPlaying,
        progressMs: state.progressMs, durationMs: state.durationMs, at: Date.now(),
      };
      startRadio([track], "");
    },
    [startRadio],
  );

  // "Open Spotify" issue: retry reconnecting every 5 s; give up after the grace.
  useEffect(() => {
    if (!sessionLive || playbackIssue?.status !== "no_device") return;
    const started = Date.now();
    const t = setInterval(() => {
      const current = radioRef.current.current;
      if (current?.spotify_id) {
        void startSpotifyPlayback(current, true, door.current?.forId === current.spotify_id ? door.current.track : null, lastPlayback.current.progressMs || undefined, "connection retry");
      } else {
        void (async () => {
          try {
            const state = await playbackFn();
            if (state.status === "ready" && state.spotifyId && state.isPlaying && !radioRef.current.active) {
              setPlaybackIssue(null);
              noDeviceSince.current = 0;
              adoptPlaying(state);
            }
          } catch { /* keep waiting */ }
        })();
      }
      if (Date.now() - started > NO_DEVICE_GRACE) stopRadio({ keepSpotify: true });
    }, 5_000);
    return () => clearInterval(t);
  }, [sessionLive, playbackIssue, stopRadio, startSpotifyPlayback, playbackFn, adoptPlaying]);

  // No session yet: watch Spotify quietly. Pressing play in the Spotify app starts a
  // session from that song. Off after a manual End session until the next prompt/search.
  useEffect(() => {
    if (sessionLive || radio.active) return;
    const t = setInterval(() => {
      if (document.hidden || watchOff.current) return;
      void (async () => {
        try {
          const state = await playbackFn();
          if (watchOff.current || radioRef.current.active) return;
          if (state.status === "ready" && state.spotifyId && state.isPlaying) adoptPlaying(state);
        } catch { /* not connected yet */ }
      })();
    }, 5_000);
    return () => clearInterval(t);
  }, [sessionLive, radio.active, playbackFn, adoptPlaying]);

  const startSession = useCallback(async () => {
    watchOff.current = false;
    setSessionLive(true);
    idleSince.current = 0;
    if (radioRef.current.active) return;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const state = await playbackFn();
        if (state.status === "ready" && state.spotifyId) {
          adoptPlaying(state);
          return;
        }
      } catch {
        // No Spotify state yet — keep trying a couple more times.
      }
      if (attempt < 4) await new Promise((r) => setTimeout(r, 2_000));
    }
    noDeviceSince.current = Date.now();
    lastLostPrompt.current = Date.now();
    setPlaybackIssue({ status: "no_device", message: "Open Spotify and play a song to start the session." });
  }, [playbackFn, adoptPlaying]);


  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "spotify-connected" || !event.data.ok) return;
      const current = radioRef.current.current;
      const queuedDoor = door.current;
      void startSpotifyPlayback(current, false, queuedDoor && current?.spotify_id === queuedDoor.forId ? queuedDoor.track : null, undefined, "oauth connected");
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
    // Launch the app via the spotify: link without navigating this page, so an
    // embedded preview frame doesn't swallow it or turn it into a web player.
    const appUrl = `spotify:track:${track.spotify_id}`;
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = appUrl;
    document.body.appendChild(frame);
    try {
      const a = document.createElement("a");
      a.href = appUrl;
      a.rel = "noopener";
      a.click();
    } catch { /* ignore */ }
    setTimeout(() => {
      frame.remove();
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      // Only fall back to Spotify Web when the app clearly didn't take focus.
      if (!appOpened && document.hasFocus()) {
        window.open(webUrl, "_blank", "noopener,noreferrer");
      }
    }, 2500);
    let attempts = 0;
    const retry = async () => {
      attempts += 1;
      const queuedDoor = door.current;
      if (await startSpotifyPlayback(track, true, queuedDoor && queuedDoor.forId === track.spotify_id ? queuedDoor.track : null, undefined, "open Spotify retry")) return;
      if (attempts < 10) retryTimer.current = setTimeout(() => void retry(), 3_000);
    };
    retryTimer.current = setTimeout(() => void retry(), 2_000);
  }, [startSpotifyPlayback]);

  const preparedAuth = usePreparedSpotifyUrl(() =>
    authUrlFn({ data: { origin: window.location.origin } }),
  );
  const connectSpotify = useCallback(async () => {
    const ready = preparedAuth.get();
    if (ready) {
      openSpotifyAuth(ready, "spotify-auth");
      return;
    }
    try {
      const { url } = await authUrlFn({ data: { origin: window.location.origin } });
      window.location.assign(url);
    } catch {
      setPlaybackIssue({ status: "unavailable", message: "Spotify could not be connected." });
    }
  }, [authUrlFn, preparedAuth]);

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
          preSkip: preSkip.current, plan: landingPlan.current,
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
        landingPlan.current = snap.plan;
        setUpNext(snap.upNext);
        setUpSkip(snap.upSkip);
        note("steer", "Side road toggled back → keeping the original doors");
        return;
      }
      if (s.active && nextLens) log({ name: `lens:${nextLens}`, artists: "" }, "steer", s);
      if (s.active && nextDeep) log({ name: "deep cuts", artists: "" }, "steer", s);
      branches.current = null;
      preSkip.current = null;
      listGeneration.current += 1;
      awaitingSkipPair.current = false;
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
        endSession: () => {
          watchOff.current = true; // hand Spotify back: don't auto-adopt again
          stopRadio();
        },
        hasLastSession,
        resumeLastSession,
        events,
        spotifyIdle,
        calming,
        foreignQueued,
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
        onRetry={() => {
          const current = radioRef.current.current;
          const queuedDoor = door.current;
          void startSpotifyPlayback(current, false, queuedDoor && current?.spotify_id === queuedDoor.forId ? queuedDoor.track : null, undefined, "manual retry");
        }}
      />
    </RadioContext.Provider>
  );
}

export function useRadio() {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio must be used inside RadioProvider");
  return ctx;
}
