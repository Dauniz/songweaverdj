import { LIVE_KEY, readLiveSession } from "@/lib/live-session";
import { isFinished } from "@/lib/pick-rules";
import { dedupePicks, nextDistinctIndex } from "@/lib/dedupe-picks";

const LAST_KEY = "songweaver-last-session";
/** End the session when Spotify shows no open device for this long. */
const NO_DEVICE_GRACE = 90_000;
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { addToUserQueue, advanceUserQueue } from "@/lib/user-queue";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { logListeningEvent } from "@/lib/radio.functions";
import { nextPathTrack, judgeForeignPick } from "@/lib/path.functions";
import { saveHandoverNote, takeHandoverNote } from "@/lib/handover.functions";
import { synthesizeMemories } from "@/lib/taste-synthesis.functions";
import { saveSteerInsight } from "@/lib/memory.functions";
import { LENS_IDS, lensName, type LensId } from "@/lib/lenses";
import { pushSpotifyLog, ackSpotifySend, observeSpotify } from "@/lib/spotify-log";
import { endSpotifySession, findOpenSpotify, getForeignQueueCount, getSpotifyAuthUrl, getSpotifyPlayback,
  getNextQueuedId, nextSpotifyTrack, pauseSpotifyPlayback, playSpotifyTrack } from "@/lib/spotify.functions";
import { isAppleTouchDevice, openSpotifyAuth, usePreparedSpotifyUrl } from "@/lib/spotify-open";
import type { CardTrack } from "./TrackCard";
import { SpotifyOpenDialog } from "./SpotifyOpenDialog";

export type Road = "vibe" | "era" | "mixed";
/** altRoad: the alternative road it was picked under (its tag), if any. */
export type RadioTrack = CardTrack & { why?: string; altRoad?: string };
export type SpotifyPlaybackIssue = {
  status: "no_device" | "premium_required" | "connect_required" | "unavailable";
  message: string;
};

/** Spotify Connect can play only real Spotify catalog tracks. */
function isPlayable(t: CardTrack) {
  return Boolean(t.spotify_id && !t.spotify_id.startsWith("demo-"));
}


export type MazeEvent = { at: number; kind: "start" | "finish" | "skip" | "pick" | "reroot" | "think" | "door" | "steer"; text: string };
const ROAD_NAME: Record<Road, string> = { vibe: "Vibe road", era: "Era road", mixed: "New angle" };

type HistoryItem = { spotifyId: string; name: string; artists: string; outcome: "played" | "skipped" };

export type RadioState = {
  active: boolean;
  current: RadioTrack | null;
  seed: RadioTrack | null;
  seedPrompt: string;
  road: Road;
  /** Late: chips survive from restored sessions but new chips are chat steering (steerNote). */
  chips: string[];
  /** Mid-session chat steering: every future pick must respect this until it's reached. */
  steerNote: string;
  history: HistoryItem[];
  consecutiveSkips: number;
  /** Last Era/Vibe road, used for "if you finish" after a New angle. */
  baseRoad?: Road;
  /** Road the current run of skips started on (the skip ladder). */
  ladderStart?: Road | undefined;
  /** Era Road step that hops to a nearby era instead of the closest days. */
  eraShift?: boolean;
  sessionId: string;
};

type Outcome = "played" | "skipped" | "replay";

export type DoorSlot = { name: string; artists: string; road: string } | null | undefined;
export type DoorPeek = { current: string | null; B: DoorSlot; v: DoorSlot; C: DoorSlot; w: DoorSlot };

type RadioContextValue = {
  radio: RadioState;
  upNext: RadioTrack | null;
  upSkip: { track: RadioTrack; road: Road } | null;
  /** Debug (read-only): snapshot of the prepared doors. undefined = still choosing, null = none. */
  peekDoors: () => Promise<DoorPeek>;
  thinking: boolean;
  /** Chat steering: apply a direction (and optional picks) to the upcoming doors; C stays queued. */
  steerSession: (note: string, picks?: CardTrack[]) => Promise<void>;
  startRadio: (tracks: CardTrack[], seedPrompt: string, startAt?: number, startRoad?: Road) => void;
  rerootTo: (track: CardTrack, prompt?: string) => void;
  /** Search "Queue": the song plays next whether you finish or skip; nothing goes into Spotify's queue. */
  queueTrack: (track: CardTrack) => void;
  stopRadio: () => void;
  next: (outcome: Outcome) => void;
  /** Media "next" button: always lands on Crate's skip door, never your own Spotify queue. */
  skipNow: () => Promise<void>;
  lens: LensId | null;
  setLens: (lens: LensId | null) => void;
  deepCuts: boolean;
  setDeepCuts: (enabled: boolean) => void;
  sessionLive: boolean;
  /** Crate's prompt playlist while it is still running (display only). */
  promptPlaylist: CardTrack[] | null;
  /** Songs queued from search, in order (head = next song). */
  userQueue: RadioTrack[];
  startSession: () => Promise<void>;
  endSession: () => void;
  hasLastSession: boolean;
  resumeLastSession: () => void;
  events: MazeEvent[];
  spotifyIdle: boolean;
  /** Spotify is actually producing sound right now (drives the live equaliser icon). */
  musicPlaying: boolean;
  /** Skip-spam cooldown: Spotify paused, Crate catching its breath. */
  calming: boolean;
  foreignQueued: number;
  /** Live session but Spotify connection is lost (no device / playback refused). */
  spotifyLost: boolean;
  /** Latest Spotify detection: true = a device/playback seen, false = nothing detected, null = not connected or not checked yet. */
  spotifyAlive: boolean | null;
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
  steerNote: "",
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

/** Whether an alternative road (lens or deep cuts) is on; wired to the provider's refs. */
let altRoadOn: () => boolean = () => false;

/** Pure road logic: what the next state looks like after an outcome. */
function advance(s: RadioState, outcome: "played" | "skipped"): RadioState {
  const cur = s.current!;
  const history = [
    ...s.history,
    { spotifyId: cur.spotify_id ?? cur.id, name: cur.name, artists: cur.artists, outcome },
  ].slice(-25);
  // "If you finish" is always Era or Vibe: a New angle ends as soon as a song plays through.
  const base: Road = s.road !== "mixed" ? s.road : (s.baseRoad ?? "vibe");
  if (outcome === "played") return { ...s, history, consecutiveSkips: 0, road: base, baseRoad: base, ladderStart: undefined, eraShift: false };
  const skips = s.consecutiveSkips + 1;
  // Alternative road on: it owns the skip ladder (read server-side from trailing skips),
  // so the default Vibe/Era/New-angle ladder is suspended.
  if (altRoadOn()) return { ...s, history, consecutiveSkips: skips, road: base, baseRoad: base, ladderStart: undefined, eraShift: false };
  // Skip ladder: 1 = same road (era hops to a nearby era), 2-3 = the other road
  // (era steps hop eras), 4+ = New angle.
  const start: Road = skips === 1 ? base : (s.ladderStart ?? base);
  const other: Road = start === "vibe" ? "era" : "vibe";
  const road: Road = skips === 1 ? start : skips <= 3 ? other : "mixed";
  const eraShift = road === "era" && (skips === 1 || skips === 3);
  return { ...s, history, consecutiveSkips: skips, road, baseRoad: road === "mixed" ? base : road, ladderStart: start, eraShift };
}

export function RadioProvider({ children }: { children: ReactNode }) {
  const [radio, setRadio] = useState<RadioState>(IDLE);
  const [thinking, setThinking] = useState(false);
  const logFn = useServerFn(logListeningEvent);
  const pathFn = useServerFn(nextPathTrack);
  const judgeFn = useServerFn(judgeForeignPick);
  const synthFn = useServerFn(synthesizeMemories);
  const saveSteerFn = useServerFn(saveSteerInsight);
  /** Songs logged this run — Crate reflects every few of them. */
  const logged = useRef(0);
  const reflecting = useRef(false);
  const playFn = useServerFn(playSpotifyTrack);
  const queueCountFn = useServerFn(getForeignQueueCount);
  const pauseFn = useServerFn(pauseSpotifyPlayback);
  const nextTrackFn = useServerFn(nextSpotifyTrack);
  const playbackRawFn = useServerFn(getSpotifyPlayback);
  const findOpenFn = useServerFn(findOpenSpotify);
  const nextQueuedFn = useServerFn(getNextQueuedId);
  const saveNoteFn = useServerFn(saveHandoverNote);
  const takeNoteFn = useServerFn(takeHandoverNote);
  /** Set while the page checks what the background helper did; Spotify reads wait until then. */
  const remoteCheck = useRef(false);
  /** Spotify device seen in the latest poll — sent with pushes so the server skips a device lookup. */
  const deviceIdRef = useRef<string | null>(null);
  /** Smoothed one-way delay from the browser to Spotify, used to aim the resume position. */
  const pushLatency = useRef(250);
  /** Drives the Spotify pill dot: green while a device answers, red the moment detection fails. */
  const [spotifyAlive, setSpotifyAlive] = useState<boolean | null>(null);
  const playbackFn = useCallback(async () => {
    try {
      const st = await playbackRawFn();
      if (st.status === "ready" && st.deviceId) deviceIdRef.current = st.deviceId;
      // Green only when Crate is following a song or actually hears Spotify playing.
      setSpotifyAlive(
        st.status === "ready"
          ? (st.isPlaying || radioRef.current?.active ? true : null)
          : st.status === "connect_required" ? null : false,
      );
      return st;
    } catch (e) {
      setSpotifyAlive(false);
      throw e;
    }
  }, [playbackRawFn]);
  const authUrlFn = useServerFn(getSpotifyAuthUrl);
  const qc = useQueryClient();
  const [playbackIssue, setPlaybackIssue] = useState<SpotifyPlaybackIssue | null>(null);
  const [awaitingSpotify, setAwaitingSpotify] = useState(false);
  /** When the Start button resumed an open app; a still-paused loaded song is adopted 5 s later. */
  const resumeSentAt = useRef(0);
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
  altRoadOn = () => !!lensRef.current || deepCutsRef.current;
  const artistSkips = useRef<Map<string, number>>(new Map());
  const played = useRef<string[]>([]);
  // Two prefetched branches per song: one assuming you finish it, one assuming you skip it.
  const branches = useRef<{ key: string; played: Promise<Branch>; skipped: Promise<Branch>; finishSkip?: Promise<Branch> } | null>(
    null,
  );
  // Late-bound helpers so earlier callbacks can reach functions declared further down.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const planLandingRef = useRef<((...a: any[]) => { door: Promise<Branch> } | null) | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steerRef = useRef<((...a: any[]) => Promise<void>) | null>(null);
  const checkPlanRef = useRef<((reason: "recheck" | "interval") => Promise<void>) | null>(null);
  const [upNext, setUpNext] = useState<RadioTrack | null>(null);
  const upNextRef = useRef<RadioTrack | null>(null);
  upNextRef.current = upNext;
  const [upSkip, setUpSkip] = useState<{ track: RadioTrack; road: Road } | null>(null);
  const lastSkipAsk = useRef(0);
  const lastPlayback = useRef({ spotifyId: "", ratio: 0, observed: false, progressMs: 0, durationMs: 0, at: 0 });
  const advancing = useRef(false);
  const committing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reopenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionLive, setSessionLive] = useState(false);
  const startingFor = useRef<{ id: string; at: number; sent?: boolean; logged?: boolean } | null>(null);
  /** Song the start effect already handled — re-renders must never start it twice. */
  const handledFor = useRef("");
  const watchOff = useRef(false);
  const endedOn = useRef("");
  // Track Spotify is already playing (user-chosen in Spotify) — don't restart it.
  const noPlayFor = useRef("");
  // The single song lined up behind the current one in Spotify (the "if you skip" door).
  const door = useRef<{ forId: string; track: RadioTrack } | null>(null);
  const attemptedDoor = useRef<{ forId: string; track: RadioTrack; ahead: RadioTrack | null } | null>(null);
  // "If you skip" door for the upcoming song, computed before the hand-over near the end.
  const preSkip = useRef<{ forId: string; branch: Branch } | null>(null);
  const scoutAbort = useRef<AbortController | null>(null);
  /** Prompt playlist: Crate's chat picks play in order while each is finished. idx = the playing pick.
   *  `offset` hides a prepended currently-playing song from the "song n of m" labels. */
  const promptQueue = useRef<{ list: CardTrack[]; idx: number; offset?: number } | null>(null);
  const [promptPlaylist, setPromptPlaylist] = useState<CardTrack[] | null>(null);
  const setPQ = (q: { list: CardTrack[]; idx: number; offset?: number } | null) => {
    promptQueue.current = q;
    setPromptPlaylist(q ? q.list.slice(q.offset ?? 0) : null);
  };
  /** Search queue: songs you queued, in order. The head is the next song (finish or skip). */
  const userQueue = useRef<RadioTrack[]>([]);
  const [userQueueList, setUserQueueList] = useState<RadioTrack[]>([]);
  const setUQ = (q: RadioTrack[]) => {
    userQueue.current = q;
    setUserQueueList(q);
  };
  /** The queued pick that is the fixed finish door for song `cid`, if the playlist is still running. */
  const queuedNext = (cid: string | null | undefined) => {
    const q = promptQueue.current;
    const cur = q?.list[q.idx];
    if (!q || !cid || cur?.spotify_id !== cid) return null;
    // Never the playing song again: step past any repeats of it.
    const i = nextDistinctIndex(q.list, q.idx, cur);
    return i < 0 ? null : q.list[i] ?? null;
  };
  const lensTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidePending = useRef<{ lens: LensId | null; deep: boolean } | null>(null);
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
  // After a finish hand-over: detects Spotify jumping straight past the finish song onto its
  // skip door (never seen playing) vs. a real skip by the user (finish song was seen playing).
  const handoverGuard = useRef<{
    finish: RadioTrack; skip: RadioTrack | null; stateAt: RadioState; sentAt: number; finishSeen: boolean; recovered: boolean;
    /** The song that just finished — Spotify may keep reporting it for a moment. */
    from: string;
  } | null>(null);
  const lastLogged = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const swapAborted = useRef(""); // you picked your own song during the end hand-over
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
  // Song you started yourself in Spotify: Crate never re-sends mid-song, only hands over at its end.
  const passiveFor = useRef("");
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
  // When the tab was last hidden (iOS pauses hidden tabs) — used to freeze background time.
  const hiddenAt = useRef(0);
  // Keeps the screen on during a live session so the tab isn't backgrounded as easily.
  const wakeLock = useRef<{ release: () => Promise<void>; addEventListener: (t: "release", cb: () => void) => void } | null>(null);
  const [events, setEvents] = useState<MazeEvent[]>([]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [spotifyIdle, setSpotifyIdle] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
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
      handledFor.current = saved.radio.current.spotify_id; // reload: keep Spotify untouched
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

  /** Skip counts per artist as they'd be in state `st` — counts the skips `st` imagines ahead. */
  const projectedCounts = (st?: RadioState) => {
    const m = new Map(artistSkips.current);
    if (!st) return m;
    const real = radioRef.current.history;
    const lastReal = real[real.length - 1];
    const from = lastReal ? st.history.map((h) => h.spotifyId).lastIndexOf(lastReal.spotifyId) + 1 : 0;
    for (const h of st.history.slice(from)) if (h.outcome === "skipped") m.set(h.artists, (m.get(h.artists) ?? 0) + 1);
    return m;
  };
  /** Blocked for the rest of the session: 5 skips of the same artist. */
  const avoidArtists = (st?: RadioState) =>
    [...projectedCounts(st).entries()].filter(([, n]) => n >= 5).map(([a]) => a);
  /** Cooling down: skipped within the last 5 songs — still allowed, just less likely. */
  const coolArtists = (st?: RadioState) => {
    const h = (st ?? radioRef.current).history.slice(-5);
    const avoid = new Set(avoidArtists(st));
    return [...new Set(h.filter((x) => x.outcome === "skipped").map((x) => x.artists))].filter((a) => !avoid.has(a));
  };
  /** Why a door is no longer valid in state `st` (the state it would open into), or null. */
  const doorProblem = (track: RadioTrack | undefined, st: RadioState, others: (string | null | undefined)[]) => {
    if (!track?.spotify_id) return "missing";
    if (played.current.slice(-50).includes(track.spotify_id)) return "already heard";
    if (avoidArtists(st).includes(track.artists)) return "artist would be blocked after this skip";
    if (others.includes(track.spotify_id)) return "repeats another door";
    return null;
  };

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
      // Two paths (hand-over and late-finish rescue) can report the same moment: log it once.
      const key = `${s.sessionId}|${event}|${track?.id ?? ""}|${track?.name ?? ""}`;
      if (lastLogged.current.key === key && Date.now() - lastLogged.current.at < 5_000) return;
      lastLogged.current = { key, at: Date.now() };
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
            steerNote: (s.steerNote ?? "").slice(0, 300),
            lens: lensRef.current,
            deepCuts: deepCutsRef.current,
            tzOffsetMin: new Date().getTimezoneOffset(),
            avoidArtists: avoidArtists(s).slice(0, 30),
            coolArtists: coolArtists(s).slice(0, 10),
            eraShift: Boolean(s.eraShift),
            currentId: s.current?.spotify_id ?? null,
            excludeSpotifyIds: [
              ...played.current.slice(-50),
              ...(s.current?.spotify_id ? [s.current.spotify_id] : []),
              ...extraExclude,
            ],
          },
        });
        if (!r.track) return null;
        const altRoad = deepCutsRef.current ? "Deep cuts" : lensRef.current ? lensName(lensRef.current) : undefined;
        return { track: { ...(r.track as CardTrack), why: r.why, ...(altRoad ? { altRoad } : {}) }, road: r.road };
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
      if (lensTimer.current) return; // side-road misclick buffer: keep the current doors until it settles
      const key = `${s.current.id}|${s.chips.join(",")}|${s.steerNote ?? ""}|${s.road}|${s.history.length}|${lensRef.current ?? ""}|${deepCutsRef.current ? "deep" : ""}`;
      if (branches.current?.key === key) return;
      scoutAbort.current?.abort(); // drop any scouting still running for an old key
      const ctrl = new AbortController();
      scoutAbort.current = ctrl;
      const cid = s.current.spotify_id;
      // The skip door may already be decided: queued in Spotify behind this song (preSkip), or
      // being chosen one step ahead (the landing plan). Reuse it — scouting again would put a
      // different song on screen than the one Spotify will really play.
      const ps = preSkip.current;
      const uqHead = userQueue.current[0] ?? null;
      const uqAfter = userQueue.current[1] ?? null;
      if (uqHead && cid) queued.current = { forId: cid, track: uqHead };
      const pre = !uqHead && ps && ps.forId === cid ? ps.branch : null;
      const lp = landingPlan.current;
      const plan = !uqHead && !pre && lp && lp.forId === cid && lp.sessionId === s.sessionId ? lp : null;
      const knownSkipId = pre?.track.spotify_id ?? plan?.doorVal?.track.spotify_id;
      const qNext = queuedNext(cid);
      const qPos = promptQueue.current;
      const qOff = qPos?.offset ?? 0;
      const skippedState = advance(s, "skipped");
      // The skip door must not be a later playlist song.
      const queueRest = qNext && qPos ? qPos.list.slice(qPos.idx + 1).map((t) => t.spotify_id).filter(Boolean) as string[] : [];
      // Fresh start: C first (so [A, C] goes out asap), then B avoiding C.
      const freshStart = !uqHead && !pre && !plan && s.history.length === 0;
      const earlyC: Promise<Branch> | null = freshStart ? fetchBranch(skippedState, ctrl.signal, queueRest) : null;
      const playedB: Promise<Branch> = uqHead
        ? Promise.resolve({ track: uqHead, road: advance(s, "played").road })
        : qNext
        ? Promise.resolve({ track: { ...qNext, why: `Your playlist, song ${(qPos?.idx ?? 0) + 2 - qOff} of ${(qPos?.list.length ?? 0) - qOff}` }, road: advance(s, "played").road })
        : earlyC
          ? earlyC.catch(() => null).then((c) => fetchBranch(advance(s, "played"), ctrl.signal, [c?.track.spotify_id].filter(Boolean) as string[]))
          : fetchBranch(advance(s, "played"), ctrl.signal, knownSkipId ? [knownSkipId] : []);
      // Fresh scout, in parallel with the finish door: the two must never be the same song.
      const freshSkip = () =>
        Promise.all([playedB, fetchBranch(skippedState, ctrl.signal, queueRest)]).then(([finish, first]) => {
          const finishId = finish?.track.spotify_id;
          if (first && finishId && first.track.spotify_id === finishId) return fetchBranch(skippedState, ctrl.signal, [finishId, ...queueRest]);
          return first;
        });
      const skippedB: Promise<Branch> = uqHead
        ? Promise.resolve({ track: uqHead, road: advance(s, "skipped").road })
        : earlyC
        ? earlyC.then((c) => (c && qNext && c.track.spotify_id === qNext.spotify_id ? fetchBranch(skippedState, ctrl.signal, [qNext.spotify_id!, ...queueRest]) : c))
        : pre
        ? Promise.resolve(pre)
        : plan
          ? plan.door.then((b) => (b?.track && isPlayable(b.track) ? b : freshSkip()))
          : freshSkip();
      // v: the finish door's own "if you skip" song, ready before the hand-over needs it.
      const finishSkip: Promise<Branch> = uqAfter
        ? Promise.resolve({ track: uqAfter, road: advance(s, "played").road })
        : Promise.all([playedB, skippedB]).then(([f, k]) => {
        if (!f?.track.spotify_id) return null;
        const onFinish: RadioState = { ...advance(s, "played"), current: f.track, road: f.road };
        return fetchBranch(advance(onFinish, "skipped"), ctrl.signal, [cid, k?.track.spotify_id].filter(Boolean) as string[])
          .then((b) => (b?.track.spotify_id && isPlayable(b.track) && b.track.spotify_id !== f.track.spotify_id ? b : null));
      });
      branches.current = { key, played: playedB, skipped: skippedB, finishSkip };
      if (plan && !knownSkipId && !qNext) {
        // The planned door arrives later: if it turns out to be the finish pick, re-choose the finish.
        void Promise.all([playedB, skippedB]).then(([finish, skip]) => {
          if (branches.current?.key !== key || !finish || !skip || finish.track.spotify_id !== skip.track.spotify_id) return;
          const again = fetchBranch(advance(s, "played"), ctrl.signal, [skip.track.spotify_id!]);
          // The finish song changed, so its own skip song (v) must be picked again too.
          const againSkip: Promise<Branch> = again.then((f) => {
            if (!f?.track.spotify_id) return null;
            const onFinish: RadioState = { ...advance(s, "played"), current: f.track, road: f.road };
            return fetchBranch(advance(onFinish, "skipped"), ctrl.signal, [cid, skip.track.spotify_id].filter(Boolean) as string[])
              .then((b) => (b?.track.spotify_id && isPlayable(b.track) && b.track.spotify_id !== f.track.spotify_id ? b : null));
          });
          branches.current = { key, played: again, skipped: skippedB, finishSkip: againSkip };
          void again.then((b) => {
            if (branches.current?.key === key) setUpNext(b?.track ?? null);
          });
        });
      }
      setUpNext(null);
      if (!pre) setUpSkip(null);
      const skipRoad = advance(s, "skipped").road;
      const avoid = avoidArtists();
      const cool = coolArtists();
      const ctx = [
        lensRef.current ? `alternative road ${lensRef.current}` : null,
        s.chips.length ? `steering ${s.chips.join(", ")}` : null,
        avoid.length ? `blocked ${avoid.join(", ")}` : null,
        cool.length ? `cooling ${cool.join(", ")}` : null,
        `last ${Math.min(50, played.current.length)} songs heard excluded`,
      ].filter(Boolean).join(" · ");
      note("think", `At "${s.current.name}" · on ${ROAD_NAME[s.road]} · skips in a row: ${s.consecutiveSkips}`);
      note("think", `Scouting two doors: finish → ${ROAD_NAME[advance(s, "played").road]}, skip → ${ROAD_NAME[skipRoad]}${s.consecutiveSkips >= 3 ? " (4th skip = new angle)" : ""}`);
      note("think", ctx);
      skippedB.then((b) => {
        if (branches.current?.key !== key) return;
        setUpSkip(b ?? null);
        note("door", b ? `Skip door ready: "${b.track.name}" by ${b.track.artists}${b.track.why ? ` — ${b.track.why}` : ""}` : "Skip door: nothing fits, will fall back");
        // w: start choosing C's own skip song now, unless a plan for C already exists.
        const lpNow = landingPlan.current;
        const cId = b?.track.spotify_id;
        if (b && cId && !uqHead && !(lpNow && lpNow.forId === cId && lpNow.sessionId === s.sessionId && lpNow.doorVal !== null)) {
          void playedB.then((f) => {
            if (branches.current?.key !== key) return;
            const again = landingPlan.current;
            if (again && again.forId === cId && again.sessionId === s.sessionId && again.doorVal !== null) return;
            planLandingRef.current?.(s, b, [cid, f?.track.spotify_id]);
          });
        }
      });
      // Once every door is decided, do a quick recheck that B, v, C and w are all there.
      void Promise.allSettled([playedB, skippedB, finishSkip]).then(async () => {
        await new Promise((r) => setTimeout(r, 300));
        const c = await skippedB.catch(() => null);
        const lpW = landingPlan.current;
        if (lpW && c?.track.spotify_id === lpW.forId) await lpW.door.catch(() => null);
        if (branches.current?.key === key) void checkPlanRef.current?.("recheck");
      });
      playedB.then((b) => {
        if (branches.current?.key !== key) return;
        setUpNext(b?.track ?? null);
        note("door", b ? `Finish door ready: "${b.track.name}" by ${b.track.artists}${b.track.why ? ` — ${b.track.why}` : ""}` : "Finish door: nothing fits, will fall back");
      });
    },
    [fetchBranch, note],
  );

  // Prompt playlist: finishing a pick moves on to the next; any other song ends the playlist.
  useEffect(() => {
    const q = promptQueue.current;
    if (!q) return;
    const id = radio.current?.spotify_id;
    if (!radio.active || !id) {
      setPQ(null);
      return;
    }
    const curPick = q.list[q.idx];
    if (id === curPick?.spotify_id) return;
    const ni = curPick ? nextDistinctIndex(q.list, q.idx, curPick) : -1;
    if (ni >= 0 && id === q.list[ni]?.spotify_id) {
      if (ni > q.idx + 1) note("think", "Skipped a repeat in your playlist");
      q.idx = ni;
      if (q.idx >= q.list.length - 1) {
        setPQ(null);
        note("think", "Last song of your playlist — after this Crate is back in the maze");
      } else note("think", `Your playlist: song ${q.idx + 1 - (q.offset ?? 0)} of ${q.list.length - (q.offset ?? 0)}`);
      return;
    }
    setPQ(null);
    note("think", "Left your playlist — Crate is back in the maze");
  }, [radio.active, radio.current?.spotify_id, note]);

  // Search queue: when the head starts playing, drop it — the next queued song becomes the door.
  useEffect(() => {
    const id = radio.current?.spotify_id;
    if (!radio.active) {
      if (userQueue.current.length) setUQ([]);
      return;
    }
    const n = advanceUserQueue(userQueue.current, id);
    if (n === userQueue.current) return;
    setUQ(n);
    note("think", n.length ? `Your queue: "${n[0]?.name}" is next (${n.length} left)` : "Last queued song — after this Crate is back in the maze");
  }, [radio.active, radio.current?.spotify_id, note]);

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

  // Plan check: right after the doors are decided, and every 10 s while a song plays, make
  // sure B (finish), v (B's skip), C (skip) and w (C's skip) are all picked. Repairs only
  // prepare picks — nothing is sent to Spotify mid-song.
  const repairing = useRef(false);
  const pendingSteer = useRef<{ note: string | undefined; picks: CardTrack[] | undefined; opts: undefined | { keepQueue?: boolean; keepW?: boolean; source?: "search" | "prompt" | "road"; prompt?: string; label?: string; queue?: boolean } } | null>(null);
  /** A queued search song: next on finish (as B) and on skip (Crate redirects the skip to it). */
  const queued = useRef<{ forId: string; track: RadioTrack } | null>(null);
  const checkPlan = useCallback(
    async (reason: "recheck" | "interval") => {
      const s = radioRef.current;
      const entry = branches.current;
      if (repairing.current || swapping.current || calmingRef.current || !s.active || !s.current?.spotify_id || !entry) return;
      if (!entry.key.startsWith(`${s.current.id}|`) || lensTimer.current) return;
      if (reason === "interval" && (!lastPlayback.current.observed || Date.now() - lastPlayback.current.at > 15_000)) return;
      repairing.current = true;
      try {
        const key = entry.key;
        const cid = s.current.spotify_id;
        const settled = <T,>(p: Promise<T> | undefined) => (p ? withTimeout(p.catch(() => null), 1_500, undefined as unknown as T) : Promise.resolve(null as T));
        const [b, c, v] = await Promise.all([settled(entry.played), settled(entry.skipped), settled(entry.finishSkip)]);
        // undefined = still being picked; leave it alone.
        if (b === undefined || c === undefined || v === undefined) return;
        const repaired: string[] = [];
        const why = (slot: string, p: string | null) => {
          if (p && p !== "missing") note("door", `DOOR CHECK: replacing ${slot} — ${p}`);
          return p;
        };
        const sState = advance(s, "skipped");
        const fState = advance(s, "played");
        const qB = queuedNext(cid) ?? userQueue.current[0] ?? null;
        // A playlist pick is the user's own choice: never swapped for "already heard" etc.
        let finish = qB && b?.track.spotify_id === qB.spotify_id ? b : why("B", doorProblem(b?.track, fState, [cid])) ? null : b;
        if (!finish?.track.spotify_id) {
          const nb = await fetchBranch(advance(s, "played"), undefined, [c?.track.spotify_id].filter(Boolean) as string[]);
          if (branches.current?.key !== key || !nb) return;
          finish = nb;
          branches.current = { key: branches.current.key, played: Promise.resolve(nb), skipped: branches.current.skipped };
          setUpNext(nb.track);
          note("door", `PLAN REPAIRED: picked missing finish door B "${nb.track.name}"`);
          repaired.push("B");
        }
        // C is already queued in Spotify; replacing it early rides the normal skip-door push.
        let skip = qB && userQueue.current[0] && c?.track.spotify_id === userQueue.current[0].spotify_id ? c : why("C", doorProblem(c?.track, sState, [cid, finish.track.spotify_id])) ? null : c;
        if (!skip?.track.spotify_id) {
          const nc = await fetchBranch(advance(s, "skipped"), undefined, [finish.track.spotify_id].filter(Boolean) as string[]);
          if (branches.current?.key !== key || !nc) return;
          skip = nc;
          branches.current = { ...branches.current, skipped: Promise.resolve(nc) };
          setUpSkip(nc);
          note("door", `PLAN REPAIRED: picked missing skip door C "${nc.track.name}"`);
          repaired.push("C");
        }
        const fid = finish.track.spotify_id;
        const sid = skip.track.spotify_id!;
        const vv = branches.current?.finishSkip === entry.finishSkip ? v : null;
        const onFinish: RadioState = { ...fState, current: finish.track, road: finish.road };
        const vOk = vv && !why("v", doorProblem(vv.track, advance(onFinish, "skipped"), [fid, cid, sid]));
        if (!vOk) {
          const nv = await fetchBranch(advance(onFinish, "skipped"), undefined, [cid, fid, sid].filter(Boolean) as string[]);
          if (branches.current?.key !== key || !nv?.track.spotify_id || !isPlayable(nv.track) || nv.track.spotify_id === fid) return;
          branches.current = { ...branches.current, finishSkip: Promise.resolve(nv) };
          note("door", `PLAN REPAIRED: picked missing v (skip after B) "${nv.track.name}"`);
          repaired.push("v");
        }
        // w: C's own skip song, kept in the landing plan for C.
        const lp = landingPlan.current;
        const lpMatches = lp && lp.forId === sid && lp.sessionId === s.sessionId;
        const wPending = lpMatches && lp.doorVal === undefined;
        const wVal = lpMatches ? lp.doorVal : null;
        const onSkip: RadioState = { ...sState, current: skip.track, road: skip.road };
        const wOk = wVal && !why("w", doorProblem(wVal.track, advance(onSkip, "skipped"), [sid, cid, fid]));
        if (!wPending && !wOk) {
          const plan = planLandingRef.current?.(s, skip, [cid, fid]);
          const nw = plan ? await plan.door : null;
          if (branches.current?.key !== key) return;
          if (nw) {
            note("door", `PLAN REPAIRED: picked missing w (skip after C) "${nw.track.name}"`);
            repaired.push("w");
          }
        }
        if (reason === "recheck" && !repaired.length && !wPending) note("door", "DOOR CHECK: B, v, C, w all valid");
      } catch {
        /* try again next check */
      } finally {
        repairing.current = false;
      }
    },
    [fetchBranch, note],
  );
  checkPlanRef.current = checkPlan;
  useEffect(() => {
    if (!sessionLive || calming) return;
    const t = setInterval(() => void checkPlan("interval"), 10_000);
    return () => clearInterval(t);
  }, [sessionLive, calming, checkPlan]);

  const startRadio = useCallback(
    (tracks: CardTrack[], seedPrompt: string, startAt = 0, startRoad?: Road) => {
      const ordered = [...tracks.slice(startAt), ...tracks.slice(0, startAt)];
      const first = ordered.find(isPlayable) ?? null;
      artistSkips.current = new Map();
      played.current = [];
      branches.current = null;
      // Fresh session: drop any line-up state left over from a previous one, or a stale
      // "second rapid skip" flag pauses Spotify seconds after the new song starts.
      door.current = null;
      preSkip.current = null;
      lineup.current = [];
      lineupTracks.current = new Map();
      landingPlan.current = null;
      awaitingSkipPair.current = false;
      quickSkipUntil.current = 0;
      handledFor.current = "";
      if (!first) {
        setRadio(IDLE);
        return;
      }
      const road: Road = startRoad ?? (NOSTALGIA.test(seedPrompt) ? "era" : "vibe");
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
          text: `Starts from "${first.name}" on ${ROAD_NAME[road]}${startRoad ? " (read from your prompt)" : road === "era" ? " (you mentioned nostalgia)" : ""}`,
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
    (track: CardTrack, prompt?: string) => {
      const s = radioRef.current;
      if (!s.active) {
        startRadio([track], prompt ?? "");
        return;
      }
      // Mid-session: the current song keeps playing; the pick becomes the finish door (B).
      if (!sessionLive) setSessionLive(true);
      void steerRef.current?.("", [track], { source: prompt ? "prompt" : "search", keepW: true, keepQueue: !!prompt, prompt });
    },
    [startRadio, log, note, sessionLive],
  );

  /** Prompt results: start a session when none runs, otherwise replan the live one. */
  const startOrReplan = useCallback(
    (allTracks: CardTrack[], seedPrompt: string, startAt = 0, startRoad?: Road) => {
      // Never the same song twice; mid-session the playing song can't be a pick either.
      const cur = radioRef.current.active ? radioRef.current.current : null;
      const pickedAt = allTracks[startAt];
      const tracks = dedupePicks(allTracks, cur ? [cur] : []);
      if (pickedAt) startAt = Math.max(0, tracks.indexOf(pickedAt));
      // From the chosen pick onward, Crate's picks play in order while each is finished.
      const list = tracks.slice(startAt, 6).filter(isPlayable);
      setPQ(list.length > 1 ? { list, idx: 0 } : null);
      if (!radioRef.current.active) return startRadio(tracks, seedPrompt, startAt, startRoad);
      const ordered = [...tracks.slice(startAt), ...tracks.slice(0, startAt)];
      const first = ordered.find(isPlayable);
      if (first) {
        // Live session: the current song keeps playing; the first pick becomes B, the rest follow.
        setPQ(list.length > 1 ? { list, idx: 0 } : null); // pick 1 plays now (skip), pick 2 follows on finish
        void steerRef.current?.("", [first], { source: "prompt", keepW: true, keepQueue: true, prompt: seedPrompt });
      }
    },
    [startRadio, rerootTo],
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
      }
      const pending = branches.current?.[outcome];
      setThinking(true);
      let b = pending ? await pending : null;
      // Doors were checked ahead ("what if") — never swap one that's opening; only fill a gap.
      if (!b) b = await fetchBranch(nextState);
      else if (avoidArtists().includes(b.track.artists)) note("think", `"${b.track.name}" is by a blocked artist, but Spotify already opened it — keeping it`);
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
      void atFrontier;
      const ahead: Promise<Branch> = Promise.resolve(null);
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
  planLandingRef.current = planLanding;

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
      // Retries (Spotify was closed, "Open Spotify", reconnect) often don't know the skip
      // song because it's only confirmed after a successful send. Reuse the last one tried.
      const pending = attemptedDoor.current?.forId === track.spotify_id ? attemptedDoor.current : null;
      const pre = preSkip.current?.forId === track.spotify_id ? preSkip.current.branch?.track ?? null : null;
      if (!skipDoor || !isPlayable(skipDoor)) skipDoor = pending?.track ?? pre ?? skipDoor;
      if (!aheadDoor && pending?.ahead && skipDoor?.spotify_id === pending.track.spotify_id) aheadDoor = pending.ahead;
      if (skipDoor?.spotify_id && isPlayable(skipDoor) && skipDoor.spotify_id !== track.spotify_id) {
        attemptedDoor.current = { forId: track.spotify_id, track: skipDoor, ahead: aheadDoor ?? null };
      }
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
        const sentAt = Date.now();
        const result = await playFn({
          data: { spotifyId: track.spotify_id, nextId, aheadId, positionMs, deviceId: deviceIdRef.current ?? undefined },
        }).catch((err) => {
          ackSpotifySend(logId, "error");
          throw err;
        });
        const totalMs = Date.now() - sentAt;
        if (result.status === "playing") {
          pushLatency.current = Math.round(pushLatency.current * 0.7 + Math.min(1500, totalMs / 2) * 0.3);
          pushSpotifyLog({ kind: "event", at: Date.now(), text: `PUSH TIMING — ${totalMs} ms total, ${"spotifyMs" in result ? result.spotifyMs : "?"} ms at Spotify` });
        }
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
          const oursIds = lineup.current.slice(1);
          window.setTimeout(() => {
            queueCountFn({ data: { ids: oursIds } })
              .then((r) => { if (generation === listGeneration.current) setForeignQueued(r.count); })
              .catch(() => undefined);
          }, 400);
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
    const startId = current.spotify_id;
    // Run once per song: dependency churn used to re-run this and restart a song the user
    // had just started in Spotify from 0:00, which then looked like a loop and paused.
    if (handledFor.current === startId) return;
    handledFor.current = startId;
    // Already playing in Spotify (started there): keep it going, only add Crate's skip songs.
    const alreadyPlaying = noPlayFor.current === startId;
    noPlayFor.current = "";
    passiveFor.current = "";
    // Adopted songs already play in Spotify, so the mirror keeps watching for your next switch.
    if (!alreadyPlaying) startingFor.current = { id: startId, at: Date.now() };
    const release = () => {
      if (startingFor.current?.id === startId) startingFor.current = null;
    };
    const ready = preSkip.current?.forId === current.spotify_id ? preSkip.current!.branch : null;
    const stale = () => radioRef.current.current?.spotify_id !== startId || handledFor.current !== startId;
    void (async () => {
      let branch: Branch = ready?.track && isPlayable(ready.track) ? ready : null;
      if (!branch) {
        const prefix = `${current.id}|`;
        for (let i = 0; i < 20 && !branches.current?.key.startsWith(prefix); i++) {
          await new Promise((res) => setTimeout(res, 100));
          if (stale()) return;
        }
        const b = branches.current?.key.startsWith(prefix) ? branches.current : null;
        // A song started inside Spotify brings its playlist/album along as "next up". Take over
        // fast so Spotify doesn't drift into that list (and Crate chase it) while Crate thinks.
        branch = await withTimeout(
          (b ? b.skipped : fetchBranch(advance(radioRef.current, "skipped"))).catch(() => null),
          alreadyPlaying ? 15_000 : 6_000, // fresh start: A must not wait long for C
          null,
        );
      }
      if (stale()) return;
      const skip = branch?.track && isPlayable(branch.track) && branch.track.spotify_id !== current.spotify_id ? branch : null;
      if (skip) setUpSkip(skip);
      // Entry point (prompt, search, or a song started in Spotify): push [A, C] now. The landing
      // plan (w) and the finish side (B, v) keep being prepared in the background.
      let pos: number | undefined;
      if (alreadyPlaying) {
        try {
          const t0 = Date.now();
          const st = await playbackFn();
          if (st.status === "ready" && st.spotifyId === startId) pos = st.progressMs + Math.round((Date.now() - t0) / 2) + 150;
        } catch { /* estimate below */ }
        if (pos === undefined) {
          const lp = lastPlayback.current;
          pos = lp.spotifyId === startId ? lp.progressMs + (Date.now() - lp.at) : undefined;
        }
        if (stale()) return release();
        pushSpotifyLog({ kind: "event", at: Date.now(), text: `ADOPT — "${current.name}" re-sent once with its skip door` });
      }
      pushSpotifyLog({ kind: "event", at: Date.now(), text: `START PAIR — "${current.name}" + skip door ${skip ? `"${skip.track.name}"` : "(none yet, pushed when ready)"}` });
      await startSpotifyPlayback(current, false, skip?.track ?? null, pos ? Math.max(1, Math.round(pos)) : undefined, alreadyPlaying ? "adopt" : "session start", null);
      // Keep ignoring foreign reports until Spotify shows the sent song (max 8 s from now).
      if (!alreadyPlaying && startingFor.current?.id === startId) startingFor.current = { id: startId, at: Date.now(), sent: true };
      if (!alreadyPlaying) {
        // Give Spotify a moment to report the new song before the mirror resumes.
        lastPlayback.current = { spotifyId: startId, ratio: 0, observed: false, progressMs: 0, durationMs: 0, at: Date.now() };
      }
      if (alreadyPlaying) setTimeout(release, 1_500); // fresh starts are released by the poll
    })();
  }, [sessionLive, radio.active, radio.current?.spotify_id, startSpotifyPlayback, fetchBranch, playbackFn]);


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
      handledFor.current = track.spotify_id ?? ""; // this path sends its own list
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

  /** Media "next": if Crate's skip door already sits right behind the current song in Spotify,
   *  a plain Spotify "next" is enough. Otherwise (e.g. a song you started in Spotify, still on
   *  your own queue) wait briefly for the door and play it directly, counted as a skip. */
  const skipNow = useCallback(async () => {
    const qd = queued.current;
    if (qd && qd.forId === radioRef.current.current?.spotify_id) {
      queued.current = null;
      acceptObserved(qd.track, "skipped", false);
      await startSpotifyPlayback(qd.track, true, userQueue.current[1] ?? null, undefined, "queued next");
      return;
    }
    const inLine = () => {
      const d = upSkipRef.current?.track.spotify_id;
      const cur = lastPlayback.current.spotifyId;
      const at = cur ? lineup.current.indexOf(cur) : -1;
      return !!d && at >= 0 && lineup.current[at + 1] === d;
    };
    const until = Date.now() + 5_000;
    while (!inLine() && !upSkipRef.current && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    if (inLine()) { await nextTrackFn(); return; }
    // Give an in-flight adopt send a moment to land the pair.
    const settle = Date.now() + 1_500;
    while (!inLine() && Date.now() < settle && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    if (inLine()) { await nextTrackFn(); return; }
    const d = upSkipRef.current;
    if (!d?.track.spotify_id || !radioRef.current.current) { await nextTrackFn(); return; }
    pushSpotifyLog({ kind: "event", at: Date.now(), text: `NEXT BUTTON — skip door not in Spotify's queue yet, playing "${d.track.name}" directly` });
    acceptObserved(d.track, "skipped", false);
    await startSpotifyPlayback(d.track, true, null, undefined, "next button");
  }, [nextTrackFn, acceptObserved, startSpotifyPlayback]);

  /** A song you started in Spotify that's far from the maze's direction steers B and v toward it. */
  const judgeForeign = async (pick: RadioTrack, before: RadioState) => {
    const recent = [
      ...(before.current ? [{ name: before.current.name, artists: before.current.artists }] : []),
      ...before.history.slice(-5).map((h) => ({ name: h.name, artists: h.artists })),
    ];
    const pa = pick.artists.toLowerCase();
    if (recent.some((r) => r.artists && pa && (r.artists.toLowerCase().includes(pa) || pa.includes(r.artists.toLowerCase())))) return;
    try {
      const r = await judgeFn({ data: { pick: { name: pick.name, artists: pick.artists }, recent: recent.slice(0, 8), road: before.road, steerNote: before.steerNote || undefined } });
      if (!r.far || !r.note) return;
      if (radioRef.current.current?.spotify_id !== pick.spotify_id || radioRef.current.sessionId !== before.sessionId) return;
      note("steer", `Your pick in Spotify — steering toward ${r.note}`);
      await steerRef.current?.(r.note);
    } catch {
      // The maze just continues as a normal skip.
    }
  };

  // Line up exactly one song behind the current one: the "if you skip" door.
  // Spotify then lands on it if you skip; near the end Crate swaps in the "if you finish" pick.
  useEffect(() => {
    const cur = radio.current;
    const skip = upSkip?.track;
    if (!sessionLive || !cur?.spotify_id || !skip?.spotify_id || !isPlayable(skip) || skip.spotify_id === cur.spotify_id) return;
    if (calmingRef.current) return; // hands off Spotify while Crate waits out the clicking
    if (door.current?.forId === cur.spotify_id && door.current.track.spotify_id === skip.spotify_id) return;
    if (lastPlayback.current.spotifyId !== cur.spotify_id) return;
    if (passiveFor.current === cur.spotify_id) return; // your own Spotify pick: never resend mid-song
    // Already lined up behind this song in Spotify (sent one step ahead) — no re-send, no glitch.
    const at = lineup.current.indexOf(cur.spotify_id);
    if (at >= 0 && lineup.current[at + 1] === skip.spotify_id) {
      door.current = { forId: cur.spotify_id, track: skip };
      // Confirm Spotify really has it next; if not, resend so a skip door is always in "next up".
      const curId = cur.spotify_id;
      void nextQueuedFn().then((r) => {
        if (!r.id || r.id === skip.spotify_id) return;
        if (radioRef.current.current?.spotify_id !== curId || swapping.current === curId) return;
        if (lastPlayback.current.spotifyId !== curId) return;
        pushSpotifyLog({ kind: "event", at: Date.now(), text: `Skip door "${skip.name}" missing from next up — re-sending` });
        lineup.current = [];
        door.current = null;
        setResendTick((t) => t + 1);
      }).catch(() => undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      // Send the new authoritative pair the moment the skip door is ready.
      if (cancelled || radioRef.current.current?.spotify_id !== cur.spotify_id) return;
      if (swapping.current === cur.spotify_id) return; // end-of-song hand-over owns the line-up now
      // Aim from the latest poll — no extra position lookup before pushing.
      const lp = lastPlayback.current;
      const pos = Math.max(0, lp.progressMs + (Date.now() - lp.at) + pushLatency.current);
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
      swapAborted.current = "";
      const deadline = Date.now() + remainingMs;
      // Use exactly the "if you finish" pick shown on screen — never a different one.
      const shown = upNextRef.current;
      const notCur = (b: Branch) => (b?.track.spotify_id && b.track.spotify_id !== cur.spotify_id ? b : null);
      let finishB: Branch = shown?.spotify_id && isPlayable(shown) ? notCur({ track: shown, road: s.road }) : null;
      if (!finishB) finishB = notCur((await branches.current?.played) ?? null);
      if (!finishB) finishB = notCur(await fetchBranch(advance(s, "played"), undefined, [cur.spotify_id]));
      if (shown?.spotify_id === cur.spotify_id) note("think", "Skipped a repeat in your playlist");
      if (!finishB?.track.spotify_id || !isPlayable(finishB.track)) {
        swapping.current = ""; // let the next check try again
        return;
      }
      const afterState = { ...advance(s, "played"), current: finishB.track, road: finishB.road };
      // v: the finish door's own skip song, normally pre-planned while this song played.
      const okSkip = (b: Branch) => (b?.track.spotify_id && isPlayable(b.track) && b.track.spotify_id !== finishB!.track.spotify_id && b.track.spotify_id !== cur.spotify_id ? b : null);
      const pre = branches.current?.key.startsWith(`${cur.id}|`) ? branches.current.finishSkip : undefined;
      let skipB: Branch = pre ? okSkip(await withTimeout(pre.catch(() => null), Math.max(0, deadline - Date.now() - 2_500), null)) : null;
      if (!skipB) skipB = okSkip(await withTimeout(fetchBranch(advance(afterState, "skipped")), Math.max(0, deadline - Date.now() - 2_500), null));
      // Never leave Spotify's "next up" empty: fall back to the current skip door.
      if (!skipB && door.current?.forId === cur.spotify_id) skipB = okSkip({ track: door.current.track, road: advance(afterState, "skipped").road });
      if (!skipB) skipB = okSkip((await withTimeout((branches.current?.skipped ?? Promise.resolve(null)).catch(() => null), 1_000, null)) ?? null);
      // Get close to the end, then re-read Spotify's real position so the swap lands
      // right as the song ends — not seconds early, and not after the skip door has started.
      let end = deadline;
      await new Promise((res) => setTimeout(res, Math.max(0, end - Date.now() - 2_500)));
      try {
        const st = await playbackFn();
        if (st.status === "ready" && st.spotifyId === cur.spotify_id && st.durationMs) {
          end = Date.now() + Math.max(0, st.durationMs - st.progressMs);
        } else if (st.status === "ready" && st.spotifyId && st.spotifyId !== cur.spotify_id && !lineup.current.includes(st.spotifyId)) {
          // You started another song in Spotify during the last seconds — never override it.
          if (swapping.current === cur.spotify_id) swapping.current = "";
          return;
        }
      } catch {
        /* keep the estimate */
      }
      // Fire a beat before the last millisecond: the round-trip to Spotify takes time, and
      // sending while the track is in its final moments makes Spotify skip straight past the
      // first song in the list. The final ~1 s of a track is almost always silence/fade.
      // ~3 s early: if Spotify's own "track ended → next" overlaps the new list, it skips
      // straight past the finish song. Losing ~3 s of fade-out is the lesser evil.
      await new Promise((res) => setTimeout(res, Math.max(0, end - Date.now() - 3_000)));
      const now = radioRef.current;
      if (swapAborted.current === cur.spotify_id) return; // the poll saw your own pick
      if (now.sessionId !== s.sessionId || now.current?.spotify_id !== cur.spotify_id) {
        if (swapping.current === cur.spotify_id) swapping.current = "";
        pendingSteer.current = null;
        return; // you moved on yourself
      }
      // Tell Spotify first; only move Crate forward once Spotify actually took the finish pick.
      // Send the finish pick AND its "if you skip" door in the same call, so nothing has to be
      // re-sent while the new song plays (a mid-song re-send makes Spotify re-buffer audibly).
      noPlayFor.current = finishB.track.spotify_id;
      handledFor.current = finishB.track.spotify_id ?? "";
      committing.current = true;
      let ok = false;
      try {
        ok = await startSpotifyPlayback(
          finishB.track, true,
          skipB?.track ?? null,
          undefined,
          "finish handover",
          null,
          { stateAt: afterState },
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
      handoverGuard.current = {
        finish: finishB.track, skip: skipB?.track ?? null, stateAt: afterState,
        sentAt: Date.now(), finishSeen: false, recovered: false, from: cur.spotify_id,
      };
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
      // Not "seen playing" until Spotify actually reports it: a lagging report of the old song
      // must never count as a skip off the finish song.
      lastPlayback.current = {
        spotifyId: finishB.track.spotify_id, ratio: 0, observed: false,
        progressMs: 0, durationMs: 0, at: Date.now(),
      };
      lastTransition.current = Date.now();
      swapping.current = ""; // hand-over done — keep watching for your skips
      const ps = pendingSteer.current;
      if (ps) {
        pendingSteer.current = null;
        setTimeout(() => {
          if (radioRef.current.sessionId !== s.sessionId) return;
          void steerRef.current?.(ps.note, ps.picks, ps.opts);
        }, 1_000);
      }
    },
    [fetchBranch, log, note, startSpotifyPlayback, noteMove, playbackFn],
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
      if (radioRef.current.sessionId !== s.sessionId) return;
      // The skip door is decided here: the re-scout after resume must reuse it, not replace it
      // (a different pick on screen would trigger another re-send a few seconds in).
      preSkip.current = { forId: fresh.spotify_id ?? "", branch: doorB };
      if (
        await startSpotifyPlayback(fresh, true, doorB.track, undefined, "cooldown resume", null, { stateAt: now })
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
  }, [pauseFn, fetchBranch, startSpotifyPlayback, note]);

  // Spotify owns playback. While a session is live, mirror what Spotify plays —
  // skips, finishes and songs you pick yourself inside the Spotify app.
  useEffect(() => {
    if (!sessionLive || !radio.active || playbackIssue) return;
    const check = async () => {
      const current = radioRef.current.current;
      if (!current?.spotify_id || advancing.current || committing.current) return;
      if (remoteCheck.current && !document.hidden) return; // reading the background helper's result first
      if (Date.now() < cooldownUntil.current) return; // catching our breath
      // First list for this song not sent yet: Spotify still reports the old/paused song.
      // Reading it now would reroot or end the session and wipe the picked song.
      const st = startingFor.current;
      if (st && st.id === current.spotify_id && !st.sent && Date.now() - st.at < 20_000) return;
      if (st && st.sent && Date.now() - st.at >= 8_000) startingFor.current = null;
      // Desktop keeps watching in the background (you're usually in the Spotify app).
      // Mobile throttles hidden tabs heavily, so there we wait until Songweaver is visible.
      if (document.hidden && window.matchMedia("(pointer: coarse)").matches) {
        idleSince.current = 0;
        idlePolls.current = 0;
        return;
      }
      // Remember which song Crate was on when this check left: if Crate moves on while it's
      // in flight (hand-over, skip, landing, resume), the answer describes the past — drop it.
      const sentTransition = lastTransition.current;
      const sentFor = current.spotify_id;
      try {
        const state = await playbackFn();
        if (state.status === "ready") {
          observeSpotify(state.spotifyId, [state.name, state.artists].filter(Boolean).join(" — ") || state.spotifyId || "", state.progressMs, state.isPlaying);
        }
        if (lastTransition.current !== sentTransition || radioRef.current.current?.spotify_id !== sentFor) return;
        // Fresh start: Spotify lags ~1–2 s after a play command. Never read the old song as your pick.
        const stNow = startingFor.current;
        if (stNow && stNow.sent && stNow.id === sentFor) {
          if (state.status === "ready" && state.spotifyId === stNow.id) {
            pushSpotifyLog({ kind: "event", at: Date.now(), text: `START SEEN — Spotify now reports "${current.name}"` });
            startingFor.current = null;
          }
          else if (Date.now() - stNow.at < 8_000) {
            if (!stNow.logged) {
              stNow.logged = true;
              pushSpotifyLog({ kind: "event", at: Date.now(), text: `START WAIT — Spotify still reports ${(state as { name?: string }).name ?? state.status}` });
              note("think", `Waiting for Spotify to switch to "${current.name}"`);
            }
            return;
          } else startingFor.current = null;
        }
        // The request may have started just before Crate began a hand-over or deliberate
        // skip-spam pause. Discard that now-stale response instead of surfacing it as idle.
        if (calmingRef.current || committing.current) {
          idleSince.current = 0;
          idlePolls.current = 0;
          return;
        }
        if (swapping.current) {
          // During the end hand-over, a song Crate never queued means you picked it yourself
          // in Spotify: cancel the hand-over and follow your song instead of the finish door.
          const sw = swapping.current;
          const foreign = state.status === "ready" && !!state.spotifyId && state.spotifyId !== sw && !lineup.current.includes(state.spotifyId);
          if (!foreign) {
            idleSince.current = 0;
            idlePolls.current = 0;
            return;
          }
          swapAborted.current = sw;
          swapping.current = "";
          note("think", "You picked a song in Spotify — cancelling the finish hand-over");
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
        setMusicPlaying(playing);
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
          if (Date.now() - idleSince.current > NO_DEVICE_GRACE) {
            stopRadio(); // paused over 90 s: end the session
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
        const hg = handoverGuard.current;
        if (hg && state.status === "ready" && state.spotifyId) {
          if (state.spotifyId === hg.finish.spotify_id) {
            hg.finishSeen = true; // from now on any move is the user's own skip
            if (hg.recovered) handoverGuard.current = null;
          } else if (!hg.finishSeen && state.spotifyId === hg.from && Date.now() - hg.sentAt < 5_000) {
            // Spotify still reports the song that just finished: it hasn't switched yet.
            // Never read that as a skip or a manual pick — wait for the finish song to show up.
            return;
          } else if (
            !hg.finishSeen && !hg.recovered && hg.skip?.spotify_id === state.spotifyId &&
            Date.now() - hg.sentAt < 1_500 && current.spotify_id === hg.finish.spotify_id
          ) {
            // Spotify jumped past the finish song before it ever played: not a skip. Re-send once.
            hg.recovered = true;
            hg.sentAt = Date.now();
            pushSpotifyLog({ kind: "event", at: Date.now(), text: `FINISH RECOVERED — Spotify jumped past "${hg.finish.name}", re-sending` });
            noPlayFor.current = hg.finish.spotify_id ?? "";
            lastTransition.current = Date.now();
            lastPlayback.current = { spotifyId: hg.finish.spotify_id, ratio: 0, observed: false, progressMs: 0, durationMs: 0, at: Date.now() };
            committing.current = true;
            try {
              await startSpotifyPlayback(hg.finish, true, hg.skip, undefined, "finish recover", null, { stateAt: hg.stateAt });
            } finally {
              committing.current = false;
            }
            return;
          } else if (Date.now() - hg.sentAt > 6_000) {
            handoverGuard.current = null;
          }
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
        // The song ended but the hand-over didn't land in time, so Spotify rolled onto the skip
        // door. That was a finish, not a skip: send [finish, its skip] now.
        if (
          isFinished(previous.progressMs + Math.min(6_000, Date.now() - previous.at), previous.durationMs) && state.status === "ready" && state.spotifyId &&
          state.spotifyId !== current.spotify_id && lineup.current.includes(state.spotifyId)
        ) {
          pushSpotifyLog({ kind: "event", at: Date.now(), text: "LATE FINISH — song ended onto the skip door, sending the finish pair" });
          void handOver(0);
          return;
        }
        const sinceMove = Date.now() - lastTransition.current;
        const rapid = sinceMove < 15_000;
        // Not seen playing yet: only a rapid skip (after Spotify had time to start it) counts.
        if (!previous.observed && !(rapid && sinceMove > 2_500)) return;
        // Finished only if the song really reached its end (last poll + time since, with a few seconds of slack).
        const outcome = isFinished(previous.progressMs + Math.min(6_000, Date.now() - previous.at), previous.durationMs) ? "played" : "skipped";
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
          const qd = queued.current;
          if (qd && qd.forId === current.spotify_id && outcome === "skipped" && state.spotifyId !== qd.track.spotify_id) {
            // Skipped while a song was queued: play the queued song instead of Spotify's next-up.
            queued.current = null;
            pushSpotifyLog({ kind: "event", at: Date.now(), text: `QUEUED — skip redirected to "${qd.track.name}"` });
            acceptObserved(qd.track, "skipped", false);
            void startSpotifyPlayback(qd.track, true, userQueue.current[1] ?? null, undefined, "queued skip");
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
            // Your own Spotify pick mid-song = a skip. It takes C's place, so C's planned
            // skip door (w) goes straight in behind it: [your song, w] in one push.
            const foreignTrack = {
              id: `demo-ext-${state.spotifyId}`,
              spotify_id: state.spotifyId,
              name: state.name || "Unknown song",
              artists: state.artists,
              album: state.album,
              image_url: state.imageUrl,
              spotify_url: state.spotifyUrl,
              source_name: "Spotify",
            } as RadioTrack;
            const cId = upSkipRef.current?.track.spotify_id;
            const plan = landingPlan.current;
            if (plan && cId && plan.forId === cId && plan.sessionId === radioRef.current.sessionId) plan.forId = state.spotifyId;
            setPQ(null);
            setUQ([]);
            pushSpotifyLog({ kind: "event", at: Date.now(), text: `FOREIGN SKIP — "${foreignTrack.name}" picked in Spotify, counted as a skip; pushing w behind it` });
            const before = radioRef.current;
            acceptObserved(foreignTrack, "skipped", false, state.progressMs, state.durationMs);
            void judgeForeign(foreignTrack, before);
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
      // Near the end of a song, watch closely so a last-second pick in Spotify wins.
      timer = setTimeout(() => void loop(), swapping.current ? 500 : fast ? 800 : 1_000);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionLive, radio.active, radio.sessionId, playbackIssue, playbackFn, next, acceptObserved, stopRadio, handOver, startSpotifyPlayback, calmDown, log, note]);

  // Keep the screen on during a live session so the tab isn't backgrounded as easily.
  // Supported in Safari on iOS 16.4+; silently skipped where unavailable or denied.
  useEffect(() => {
    if (!sessionLive) return;
    let cancelled = false;
    const acquire = async () => {
      if (document.hidden || wakeLock.current) return;
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void>; addEventListener: (t: "release", cb: () => void) => void }> };
        };
        const sentinel = await nav.wakeLock?.request("screen");
        if (!sentinel) return;
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        wakeLock.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (wakeLock.current === sentinel) wakeLock.current = null;
        });
      } catch {
        // Wake lock can be denied — listening works without it.
      }
    };
    void acquire();
    const onVis = () => {
      if (!document.hidden) void acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      const sentinel = wakeLock.current;
      wakeLock.current = null;
      void sentinel?.release().catch(() => {});
    };
  }, [sessionLive]);

  // Phones freeze hidden pages, so a song can end with no one to hand over the finish song.
  // On hide: leave a note for the backend helper. On return: adopt what it did.
  useEffect(() => {
    if (!sessionLive) return;
    const noted = { trackId: "", bId: "", vId: null as string | null };
    const onVis = async () => {
      const s = radioRef.current;
      const cur = s.current;
      if (document.hidden) {
        // Desktop keeps running hidden tabs, so the page hands over itself there.
        if (!window.matchMedia("(pointer: coarse)").matches) return;
        const b = upNextRef.current;
        const lp = lastPlayback.current;
        if (!cur?.spotify_id || !b?.spotify_id || !s.sessionId || lp.spotifyId !== cur.spotify_id || !lp.durationMs) return;
        const endsAt = Math.round(lp.at + lp.durationMs - lp.progressMs);
        const pre = branches.current?.key.startsWith(`${cur.id}|`) ? branches.current.finishSkip : undefined;
        const v = pre ? await withTimeout(pre.catch(() => null), 300, null) : null;
        const vId = v?.track.spotify_id && v.track.spotify_id !== b.spotify_id ? v.track.spotify_id : null;
        noted.trackId = cur.spotify_id; noted.bId = b.spotify_id; noted.vId = vId;
        remoteCheck.current = true;
        void saveNoteFn({ data: { sessionId: s.sessionId, trackId: cur.spotify_id, endsAt, bId: b.spotify_id, vId } }).catch(() => {});
        return;
      }
      if (!remoteCheck.current) return;
      try {
        const res = await withTimeout(takeNoteFn().catch(() => null), 4_000, null);
        const now = radioRef.current;
        const b = upNextRef.current;
        if (res?.status !== "sent" || !now.current?.spotify_id || now.current.spotify_id !== res.track_id || b?.spotify_id !== res.b_id) return;
        // The helper finished the song into B: record it exactly like the page's own hand-over.
        const finishB: Branch = { track: b, road: now.road };
        const afterState = { ...advance(now, "played"), current: b, road: now.road };
        const pre = branches.current?.key.startsWith(`${now.current.id}|`) ? branches.current.finishSkip : undefined;
        const v = pre ? await withTimeout(pre.catch(() => null), 1_000, null) : null;
        const skipB: Branch = v?.track.spotify_id === res.v_id ? v : null;
        const cur = now.current;
        noPlayFor.current = b.spotify_id ?? "";
        handledFor.current = b.spotify_id ?? "";
        handoverGuard.current = { finish: b, skip: skipB?.track ?? null, stateAt: afterState, sentAt: Date.now(), finishSeen: true, recovered: false, from: cur.spotify_id ?? "" };
        lineup.current = [b.spotify_id!, ...(skipB?.track.spotify_id ? [skipB.track.spotify_id] : [])];
        lineupTracks.current = new Map([[b.spotify_id!, b], ...(skipB?.track.spotify_id ? [[skipB.track.spotify_id, skipB.track] as [string, RadioTrack]] : [])]);
        if (skipB?.track.spotify_id) {
          preSkip.current = { forId: b.spotify_id!, branch: skipB };
          door.current = { forId: b.spotify_id!, track: skipB.track };
          setUpSkip(skipB);
        } else setUpSkip(null);
        log(cur, "play_through", now);
        played.current.push(cur.spotify_id!);
        branches.current = null;
        setRadio(afterState);
        noteMove(cur, "played", finishB!.track, finishB!.road);
        pushSpotifyLog({ kind: "event", at: Date.now(), text: `BACKGROUND FINISH — helper handed over "${b.name}" while the page slept` });
        lastPlayback.current = { spotifyId: b.spotify_id, ratio: 0, observed: false, progressMs: 0, durationMs: 0, at: Date.now() };
        lastTransition.current = Date.now();
      } finally {
        remoteCheck.current = false;
      }
    };
    const handler = () => void onVis();
    document.addEventListener("visibilitychange", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      if (remoteCheck.current) { remoteCheck.current = false; void takeNoteFn().catch(() => {}); }
    };
  }, [sessionLive, saveNoteFn, takeNoteFn, log, noteMove]);

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

  // iOS pauses hidden tabs: while Songweaver was in the background Crate heard nothing.
  // On return, freeze the time away (it must not count as a pause) and re-sync with
  // what Spotify actually plays now instead of judging the jump with stale snapshots.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = 0;
      if (!sessionLive || !radioRef.current.active) return;
      // Freeze background time: shift the pause/device timers forward by the time away.
      if (away > 0) {
        if (idleSince.current) idleSince.current += away;
        if (noDeviceSince.current) noDeviceSince.current += away;
        idlePolls.current = 0;
      }
      // A hand-over that was mid-flight when the tab froze is long past — drop it.
      if (swapping.current && away > 5_000) swapping.current = "";
      // Re-sync immediately with Spotify's real state.
      void (async () => {
        try {
          const state = await playbackFn();
          if (state.status !== "ready" || !state.spotifyId) return;
          const current = radioRef.current.current;
          lastPlayback.current = {
            spotifyId: state.spotifyId,
            ratio: state.durationMs ? state.progressMs / state.durationMs : 0,
            observed: true,
            progressMs: state.progressMs,
            durationMs: state.durationMs,
            at: Date.now(),
          };
          if (current?.spotify_id && state.spotifyId !== current.spotify_id && !lineup.current.includes(state.spotifyId)) {
            // Songs moved while we were away and this one is none of Crate's: follow it fresh.
            note("think", "Welcome back — following what Spotify is playing now");
            adoptPlaying(state);
          }
        } catch {
          // The regular poll recovers on its own.
        }
      })();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sessionLive, playbackFn, adoptPlaying, note]);

  // Outside a session, keep the Spotify pill dot live: check every 20 s while the
  // tab is visible, and immediately when you come back (iPad freezes timers away).
  useEffect(() => {
    if (sessionLive) return;
    let busy = false;
    const tick = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try { await playbackFn(); } catch { /* dot already went red */ }
      finally { busy = false; }
    };
    void tick();
    const id = setInterval(tick, 20_000);
    const onVis = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [sessionLive, playbackFn]);

  // Waiting for Spotify (popup shown OR in its 10 s cooldown after "Open Spotify"):
  // check every 3 s, and immediately when the tab comes back into view (iPad/iPhone
  // freeze timers while you're in the Spotify app/tab). Only visible time counts
  // toward the give-up grace, so a trip to Spotify never ends the session.
  // Never a dead session: live, no song followed, no popup → keep waiting/polling.
  useEffect(() => {
    if (!sessionLive || radio.active || playbackIssue || awaitingSpotify) return;
    const t = setTimeout(() => {
      if (!radioRef.current.active) setAwaitingSpotify(true);
    }, 4_000);
    return () => clearTimeout(t);
  }, [sessionLive, radio.active, playbackIssue, awaitingSpotify]);
  const waitingForSpotify = sessionLive && (playbackIssue?.status === "no_device" || awaitingSpotify);
  useEffect(() => {
    if (!waitingForSpotify) return;
    let waitedMs = 0;
    let lastTick = Date.now();
    let busyCheck = false;
    const succeed = () => {
      if (reopenTimer.current) { clearTimeout(reopenTimer.current); reopenTimer.current = null; }
      noDeviceSince.current = 0;
      setPlaybackIssue(null);
      setAwaitingSpotify(false);
    };
    const tick = async () => {
      const now = Date.now();
      if (!document.hidden) waitedMs += Math.min(now - lastTick, 3_500);
      lastTick = now;
      if (busyCheck) return;
      busyCheck = true;
      try {
        const current = radioRef.current.current;
        if (current?.spotify_id) {
          if (await startSpotifyPlayback(current, true, door.current?.forId === current.spotify_id ? door.current.track : null, lastPlayback.current.progressMs || undefined, "connection retry")) succeed();
        } else {
          let state = await playbackFn();
          // A playing report without a song ID is usually Spotify mid-switch: ask once more.
          if (state.status === "ready" && state.isPlaying && !state.spotifyId) state = await playbackFn();
          const ready = state.status === "ready" && !!state.spotifyId;
          const pausedOk = ready && resumeSentAt.current > 0 && Date.now() - resumeSentAt.current >= 5_000;
          console.info("[spotify watch]", state.status, state.status === "ready" ? state.isPlaying : null, pausedOk ? "adopt paused" : "");
          if (ready && (state.status === "ready" && state.isPlaying || pausedOk) && !radioRef.current.active) {
            pushSpotifyLog({ kind: "event", at: Date.now(), text: `WAIT — adopting ${state.status === "ready" && state.isPlaying ? "playing" : "paused"} song from Spotify` });
            resumeSentAt.current = 0;
            succeed();
            adoptPlaying(state as Parameters<typeof adoptPlaying>[0]);
          }
        }
      } catch { /* keep waiting */ } finally { busyCheck = false; }
      if (waitedMs > NO_DEVICE_GRACE && !radioRef.current.active) {
        // Only give up when no Spotify app is open; an open app keeps the wait alive.
        let open = false;
        try { open = (await findOpenFn({ data: {} })).found; } catch { /* treat as gone */ }
        if (open) { waitedMs = 0; return; }
        pushSpotifyLog({ kind: "event", at: Date.now(), text: "WAIT — no Spotify app found for 90 s, ending session" });
        setAwaitingSpotify(false); stopRadio({ keepSpotify: true });
      }
    };
    const onBack = () => { if (!document.hidden) { lastTick = Date.now(); void tick(); } };
    const t = setInterval(() => void tick(), 3_000);
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    window.addEventListener("pageshow", onBack);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
      window.removeEventListener("pageshow", onBack);
    };
  }, [waitingForSpotify, stopRadio, startSpotifyPlayback, playbackFn, adoptPlaying, findOpenFn]);

  // No background watching without a session: Start session, a search or a prompt connects.

  const startSession = useCallback(async () => {
    watchOff.current = false;
    setAwaitingSpotify(false);
    setSessionLive(true);
    idleSince.current = 0;
    if (radioRef.current.active) return;
    // A playing song: keep it going and build the maze from it (adopt pushes the skip door).
    // A paused song alone doesn't prove the app is open (Spotify keeps reporting it after
    // closing), so ask Spotify's device list; an open app is woken and resumed — no popup.
    let resumed = false;
    resumeSentAt.current = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const state = await playbackFn();
        console.info("[startSession] spotify state", state.status, state.status === "ready" ? state.isPlaying : null);
        if (state.status === "ready" && state.spotifyId && state.isPlaying) {
          adoptPlaying(state);
          return;
        }
        if (!resumed) {
          const open = await findOpenFn({ data: { resume: true } });
          console.info("[startSession] open Spotify device", open.found);
          if (open.found) {
            resumed = true;
            resumeSentAt.current = Date.now();
            if (open.deviceId) deviceIdRef.current = open.deviceId;
            pushSpotifyLog({ kind: "event", at: Date.now(), text: "START — Spotify app already open, resuming it" });
          } else if (attempt > 0) break;
        } else if (state.status === "ready" && state.spotifyId && Date.now() - resumeSentAt.current >= 5_000) {
          // Open app, song loaded but still paused after the resume: adopt it anyway.
          pushSpotifyLog({ kind: "event", at: Date.now(), text: "START — adopting paused song from the open app" });
          resumeSentAt.current = 0;
          adoptPlaying(state);
          return;
        }
      } catch (err) {
        console.warn("[startSession] playback check failed", err);
      }
      if (radioRef.current.active) return;
      if (attempt < 5) await new Promise((r) => setTimeout(r, resumed ? 1_100 : 1_500));
    }
    if (radioRef.current.active) return;
    noDeviceSince.current = Date.now();
    lastLostPrompt.current = Date.now();
    setAwaitingSpotify(true);
    // The app is open but had nothing to resume: keep watching quietly instead of
    // sending the user away to open an app that is already open.
    if (resumed) return;
    setPlaybackIssue({ status: "no_device", message: "Open Spotify and play a song to start the session." });
  }, [playbackFn, adoptPlaying, findOpenFn]);


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
    const shownIssue = playbackIssue;
    // Hide the popup for a 10 s cooldown while Crate looks for Spotify; if it
    // still can't see it after that, the popup comes back.
    setPlaybackIssue(null);
    setAwaitingSpotify(true);
    const cycle = { ok: false };
    if (reopenTimer.current) clearTimeout(reopenTimer.current);
    reopenTimer.current = setTimeout(() => {
      reopenTimer.current = null;
      if (!cycle.ok && shownIssue) setPlaybackIssue((cur) => cur ?? shownIssue);
    }, 10_000);
    // Open Spotify itself, not the track: a track link makes Spotify play it inside
    // its album, filling "Next up" with album songs. Crate sends its own list instead.
    const webUrl = "https://open.spotify.com/";
    if (isAppleTouchDevice()) {
      // iPhone/iPad: in-app browsers (e.g. the Lovable app) swallow window.open
      // and universal links, showing Spotify Web inside themselves. Instead:
      // 1) fire the spotify: scheme inside the tap — iOS leaves for the app;
      // 2) if we're still visible, hand the web URL to Safari (x-safari-https),
      //    which opens the user's browser rather than an embedded window.
      let left = false;
      const onHide = () => { if (document.hidden) left = true; };
      const onBlur = () => { left = true; };
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", onBlur);
      const fire = (href: string) => {
        const a = document.createElement("a");
        a.href = href;
        a.rel = "noopener";
        a.target = "_top";
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      // Fire the app link synchronously inside the tap so iOS shows its
      // "Open in Spotify?" prompt (or switches straight to the app).
      // Published site (top-level): navigate the page itself to the scheme.
      // Inside the Lovable editor (iframe): an iframe can't navigate to a custom
      // scheme, so ask the hosting browser to open it as a new window.
      const framed = window.top !== window.self;
      try {
        if (!framed) {
          window.location.href = "spotify:";
        } else {
          // Inside the Lovable editor the preview is framed: iOS silently drops
          // custom-scheme opens from frames. Open Spotify's link in a real browser
          // tab inside the tap; Spotify's page offers "Open in app" from there.
          const w = window.open(webUrl, "_blank");
          if (!w) fire(webUrl);
        }
      } catch { try { fire("spotify:"); } catch { /* ignore */ } }
      setTimeout(() => {
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("pagehide", onBlur);
        if (left || document.hidden || framed) return;
        try { fire("x-safari-https://open.spotify.com/"); } catch { /* ignore */ }
        setTimeout(() => {
          if (!document.hidden && window.top === window.self) window.open(webUrl, "_blank", "noopener,noreferrer");
        }, 1200);
      }, 1500);
    } else {
      // Desktop: try the installed app first; fall back to Spotify Web.
      let appOpened = false;
      const onBlur = () => { appOpened = true; };
      const onVis = () => { if (document.hidden) appOpened = true; };
      window.addEventListener("blur", onBlur);
      document.addEventListener("visibilitychange", onVis);
      const appUrl = "spotify:";
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
        if (!appOpened && document.hasFocus()) {
          window.open(webUrl, "_blank", "noopener,noreferrer");
        }
      }, 2500);
    }
    let attempts = 0;
    const retry = async () => {
      attempts += 1;
      const queuedDoor = door.current;
      let ok = false;
      if (track?.spotify_id) {
        ok = await startSpotifyPlayback(track, true, queuedDoor && queuedDoor.forId === track.spotify_id ? queuedDoor.track : null, undefined, "open Spotify retry");
      } else {
        // No song yet (session just started): adopt whatever the user plays in Spotify.
        try {
          const state = await playbackFn();
          if (state.status === "ready" && state.spotifyId && state.isPlaying) { adoptPlaying(state); ok = true; }
        } catch { /* keep waiting */ }
      }
      if (ok) {
        cycle.ok = true;
        if (reopenTimer.current) { clearTimeout(reopenTimer.current); reopenTimer.current = null; }
        return;
      }
      if (attempts < 4 && reopenTimer.current) retryTimer.current = setTimeout(() => void retry(), 2_500);
    };
    retryTimer.current = setTimeout(() => void retry(), 1_500);
  }, [startSpotifyPlayback, playbackIssue, playbackFn, adoptPlaying]);

  // Desktop: open Spotify automatically instead of asking the user to click
  // "Open Spotify". At most once per minute; if Spotify still isn't found the
  // dialog returns after openSpotify's 10 s cooldown as before.
  const autoOpenAt = useRef(0);
  useEffect(() => {
    if (playbackIssue?.status !== "no_device") return;
    if (typeof window === "undefined") return;
    const touch = isAppleTouchDevice() || /Android|Mobi/i.test(navigator.userAgent);
    // Phones/tablets (test): only on the published site — inside the editor's
    // frame iOS drops app links, so the popup stays there.
    if (touch && window.top !== window.self) return;
    if (Date.now() - autoOpenAt.current < 60_000) return;
    autoOpenAt.current = Date.now();
    pushSpotifyLog({ kind: "event", at: Date.now(), text: `AUTO-OPEN — opening Spotify on ${touch ? "phone/tablet" : "desktop"}` });
    openSpotify();
  }, [playbackIssue, openSpotify]);

  const preparedAuth = usePreparedSpotifyUrl(() =>
    authUrlFn({ data: { origin: window.location.origin, framed: window.top !== window.self } }),
  );
  const connectSpotify = useCallback(async () => {
    const ready = preparedAuth.get();
    if (ready) {
      openSpotifyAuth(ready, "spotify-auth");
      return;
    }
    try {
      const { url } = await authUrlFn({ data: { origin: window.location.origin, framed: window.top !== window.self } });
      window.location.assign(url);
    } catch {
      setPlaybackIssue({ status: "unavailable", message: "Spotify could not be connected." });
    }
  }, [authUrlFn, preparedAuth]);

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);


  /** Chat steering (mid-session): the listener sends a direction like "More rap" or "I'm loving it".
   *  B (and its v, and C's own w) are re-scouted under the steer note; C stays exactly as queued —
   *  replacing a queued door would glitch Spotify's audio. Never touches the six-pick prompt queue. */
  const steerSession = useCallback(
    async (note_?: string, picks?: CardTrack[], opts?: { keepQueue?: boolean; keepW?: boolean; source?: "search" | "prompt" | "road"; prompt?: string; label?: string; queue?: boolean }) => {
      const s = radioRef.current;
      const trimmed = (note_ ?? "").trim().slice(0, 300);
      const road = opts?.source === "road";
      if (!s.active || !s.current || (!road && !trimmed && !picks?.length)) return;
      const steerPick = picks?.find((t) => t.spotify_id && isPlayable(t));
      if (!road && !trimmed && !steerPick) return;
      // Last-seconds lock: the hand-over already holds B and v — hold the steer for the next song.
      if (swapping.current && swapping.current === s.current.spotify_id) {
        pendingSteer.current = { note: note_, picks, opts };
        note("steer", "Steer saved — applies after this hand-over");
        return;
      }
      // Steering owns the maze from here: a running prompt playlist yields to the new direction.
      if (!opts?.keepQueue) setPQ(null);
      queued.current = null;
      if (!opts?.queue) setUQ([]);
      // Steering with a song = you want out of this one: skip to the pick now.
      if (steerPick && !road && !opts?.queue) {
        const why = opts?.source === "search" ? "You picked it" : opts?.source === "prompt" ? "From your prompt" : trimmed ? `Steering: ${trimmed}` : "You asked Crate to steer";
        const pick: RadioTrack = { ...steerPick, why };
        radioRef.current = { ...s, steerNote: opts?.source ? s.steerNote : trimmed || s.steerNote, ...(opts?.prompt ? { seedPrompt: opts.prompt } : {}) };
        log(steerPick, "steer", s);
        note("reroot", `Steer → skipping to "${pick.name}" now`);
        acceptObserved(pick, "skipped", false);
        if (trimmed && !opts?.source)
          void saveSteerFn({ data: { note: trimmed, sessionId: s.sessionId ?? "", tzOffsetMin: new Date().getTimezoneOffset() } })
            .then(() => qc.invalidateQueries({ queryKey: ["memories"] }))
            .catch(() => {});
        await startSpotifyPlayback(pick, true, null, undefined, "steer skip");
        return;
      }
      scoutAbort.current?.abort();
      const ctrl = new AbortController();
      scoutAbort.current = ctrl;
      const cid = s.current.spotify_id;
      // C is preserved exactly: queued behind the current song (door/preSkip) or already chosen.
      const ps = preSkip.current;
      const dn = door.current;
      const queuedTrack = ps && ps.forId === cid ? ps.branch?.track : dn && dn.forId === cid ? dn.track : null;
      const pre: Branch = queuedTrack ? { track: queuedTrack, road: advance(s, "skipped").road } : null;
      // w: re-scouted under a steer note; search/prompt picks keep an existing plan for C.
      const keepPlan = !!(opts?.keepW && pre && landingPlan.current && landingPlan.current.forId === pre.track.spotify_id);
      if (!keepPlan) landingPlan.current = null;
      const next: RadioState = { ...s, steerNote: opts?.source ? s.steerNote : trimmed, ...(opts?.prompt ? { seedPrompt: opts.prompt } : {}) };
      const playedB: Promise<Branch> = steerPick
        ? Promise.resolve({
            track: { ...steerPick, why: opts?.queue ? "You queued it" : opts?.source === "search" ? "You picked it" : opts?.source === "prompt" ? "From your prompt" : trimmed ? `Steering: ${trimmed}` : "You asked Crate to steer" },
            road: advance(next, "played").road,
          })
        : fetchBranch(next, ctrl.signal);
      const skippedB: Promise<Branch> = pre ? Promise.resolve(pre) : fetchBranch(advance(next, "skipped"), ctrl.signal);
      // v: the new finish door's own "if you skip" song, picked from B's direction.
      const finishSkip: Promise<Branch> = Promise.all([playedB, skippedB]).then(([f, k]) => {
        if (!f?.track.spotify_id) return null;
        const onFinish: RadioState = { ...advance(next, "played"), current: f.track, seed: opts?.source ? f.track : next.seed, road: f.road };
        return fetchBranch(advance(onFinish, "skipped"), ctrl.signal, [cid, k?.track.spotify_id].filter(Boolean) as string[]).then(
          (b) => (b?.track.spotify_id && isPlayable(b.track) && b.track.spotify_id !== f.track.spotify_id ? b : null),
        );
      });
      // Match prefetch's key exactly (plus the steer note) so a later prefetch call keeps these doors.
      const key = `${s.current.id}|${s.chips.join(",")}|${next.steerNote ?? ""}|${s.road}|${s.history.length}|${lensRef.current ?? ""}|${deepCutsRef.current ? "deep" : ""}`;
      branches.current = { key, played: playedB, skipped: skippedB, finishSkip };
      setUpNext(null);
      if (!pre) setUpSkip(null);
      setRadio(next);
      if (road) note("steer", opts?.label ?? "Alternative road changed → steering the doors ahead");
      else if (steerPick && opts?.source) {
        log(steerPick, "steer", s); // a deliberate choice — Walrus learns from it
        if (!opts?.queue) note("reroot", `Your pick is next: "${steerPick.name}" plays when this song ends`);
      } else note("steer", trimmed ? `Steering: "${trimmed}" → re-scouting the doors ahead` : "Steer pick applied → re-scouting the doors ahead");
      if (trimmed && !opts?.source)
        void saveSteerFn({ data: { note: trimmed, sessionId: s.sessionId ?? "", tzOffsetMin: new Date().getTimezoneOffset() } })
          .then(() => qc.invalidateQueries({ queryKey: ["memories"] }))
          .catch(() => {});
      void Promise.allSettled([playedB, skippedB, finishSkip]).then(async () => {
        await new Promise((r) => setTimeout(r, 300));
        if (branches.current?.key === key) void checkPlanRef.current?.("recheck");
      });
      skippedB.then((b) => {
        if (branches.current?.key !== key) return;
        setUpSkip(b ?? null);
        // w: re-choose the skip door's own skip under the steer note (unless a plan already covers it).
        const cId = b?.track.spotify_id;
        if (b && cId && !(landingPlan.current && landingPlan.current.forId === cId)) {
          void playedB.then((f) => {
            if (branches.current?.key !== key) return;
            if (landingPlan.current && landingPlan.current.forId === cId) return;
            planLandingRef.current?.(next, b, [cid, f?.track.spotify_id]);
          });
        }
      });
      playedB.then((b) => {
        if (branches.current?.key !== key) return;
        setUpNext(b?.track ?? null);
        note("door", b ? `Finish door ready: "${b.track.name}" by ${b.track.artists}${b.track.why ? ` — ${b.track.why}` : ""}` : "Finish door: nothing fits, will fall back");
      });
    },
    [fetchBranch, note, saveSteerFn, qc, log, acceptObserved, startSpotifyPlayback],
  );
  steerRef.current = steerSession;

  const queueTrack = useCallback((track: CardTrack) => {
    const s = radioRef.current;
    if (!s.active || !s.current?.spotify_id || !track.spotify_id) return;
    const t: RadioTrack = { ...track, altRoad: "Queued", why: "You queued it" };
    const next = addToUserQueue(userQueue.current, t, s.current.spotify_id);
    if (next === userQueue.current) {
      note("reroot", `"${t.name}" is already queued`);
      return;
    }
    const first = userQueue.current.length === 0;
    setUQ(next);
    if (!first) {
      // The first queued song's own next song is this one: make it v so the hand-over sends it.
      const e = branches.current;
      if (next.length === 2 && e && e.key.startsWith(`${s.current.id}|`)) {
        branches.current = { ...e, finishSkip: Promise.resolve({ track: t, road: advance(s, "played").road }) };
      }
      note("reroot", `Queued: "${t.name}" — #${next.length} in your queue`);
      return;
    }
    void steerSession("", [t], { source: "search", keepW: true, queue: true }).then(() => {
      if (radioRef.current.current?.spotify_id === s.current?.spotify_id) queued.current = { forId: s.current!.spotify_id!, track: t };
      note("reroot", `Queued: "${t.name}" plays next, finish or skip`);
    });
  }, [steerSession, note]);

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
      // Misclick buffer: the current doors stay until the choice has settled for ~1.2 s.
      if (!lensTimer.current) sidePending.current = { lens: prevLens, deep: prevDeep };
      if (lensTimer.current) clearTimeout(lensTimer.current);
      lensTimer.current = null;
      const pending = sidePending.current;
      if (pending && pending.lens === nextLens && pending.deep === nextDeep) {
        // Changed their mind inside the buffer → nothing was rewired, nothing to undo.
        sidePending.current = null;
        return;
      }
      if (canRestore && snap) {
        sidePending.current = null;
        scoutAbort.current?.abort();
        sideSnap.current = null;
        branches.current = snap.branches;
        preSkip.current = snap.preSkip;
        landingPlan.current = snap.plan;
        setUpNext(snap.upNext);
        setUpSkip(snap.upSkip);
        note("steer", "Alternative road toggled back → keeping the original doors");
        return;
      }
      if (!s.active) {
        sidePending.current = null;
        branches.current = null;
        preSkip.current = null;
        listGeneration.current += 1;
        awaitingSkipPair.current = false;
        return;
      }
      lensTimer.current = setTimeout(() => {
        lensTimer.current = null;
        sidePending.current = null;
        const cur = radioRef.current;
        if (!cur.active) return;
        const l = lensRef.current;
        const d = deepCutsRef.current;
        if (l) log({ name: `lens:${l}`, artists: "" }, "steer", cur);
        if (d) log({ name: "deep cuts", artists: "" }, "steer", cur);
        // Steer, don't reset: the playing song and C stay; B, v and w are re-picked under the new road.
        const label = d ? "Deep cuts" : l ? lensName(l) : null;
        void steerRef.current?.("", undefined, {
          source: "road",
          keepQueue: false,
          label: label ? `Alternative road ${label} on → steering the doors ahead` : "Alternative road off → back to the default roads",
        });
      }, 1200);
    },
    [log, note],
  );

  const setLens = useCallback((next: LensId | null) => applySideRoad(next, false), [applySideRoad]);
  const setDeepCuts = useCallback(
    (enabled: boolean) => applySideRoad(enabled ? null : lensRef.current, enabled),
    [applySideRoad],
  );

  const peekDoors = useCallback(async (): Promise<DoorPeek> => {
    const NOT_YET = Symbol("pending");
    const peek = async (p: Promise<Branch> | undefined): Promise<DoorSlot> => {
      if (!p) return undefined;
      const r = await Promise.race([p.catch(() => null), new Promise<typeof NOT_YET>((res) => setTimeout(() => res(NOT_YET), 0))]);
      if (r === NOT_YET) return undefined;
      return r ? { name: r.track.name, artists: r.track.artists, road: r.road } : null;
    };
    const cur = radioRef.current.current;
    const b = branches.current && cur && branches.current.key.startsWith(`${cur.id}|`) ? branches.current : null;
    const [B, v, C] = await Promise.all([peek(b?.played), peek(b?.finishSkip), peek(b?.skipped)]);
    const lp = landingPlan.current;
    const cId = C && b ? (await b.skipped.catch(() => null))?.track.spotify_id : undefined;
    const w = lp && cId && lp.forId === cId ? await peek(lp.door) : undefined;
    return { current: cur ? `${cur.name} — ${cur.artists}` : null, B, v, C, w };
  }, []);

  return (
    <RadioContext.Provider
      value={{
        peekDoors,
        radio,
        upNext,
        upSkip,
        thinking,
        steerSession,
        startRadio: startOrReplan,
        rerootTo,
        queueTrack,
        stopRadio,
        next,
        skipNow,
        lens,
        setLens,
        deepCuts,
        setDeepCuts,
        sessionLive,
        promptPlaylist,
        userQueue: userQueueList,
        startSession,
        endSession: () => {
          watchOff.current = true; // don't re-adopt the song you just ended on
          endedOn.current = lastPlayback.current.spotifyId;
          stopRadio();
        },
        hasLastSession,
        resumeLastSession,
        events,
        spotifyIdle,
        musicPlaying: musicPlaying && sessionLive && !spotifyIdle && !calming && !playbackIssue,
        calming,
        foreignQueued,
        spotifyLost: sessionLive && playbackIssue !== null,
        spotifyAlive,
      }}
    >
      {children}
      <SpotifyOpenDialog
        issue={playbackIssue}
        track={radio.current}
        retrying={retrying}
        onDismiss={() => {
          if (reopenTimer.current) { clearTimeout(reopenTimer.current); reopenTimer.current = null; }
          setPlaybackIssue(null);
        }}
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
