import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import type { RadioTrack } from "@/components/crate/radio-context";
import { AlertTriangle, Check, ChevronDown, ChevronUp, CornerDownRight, Flag, GitBranch, MessagesSquare, NotebookPen, Pause, Play, Route, SkipForward, Sparkles } from "lucide-react";
import { useRadio, type Road } from "@/components/crate/radio-context";
import { addMemory } from "@/lib/memory.functions";
import { pauseSpotifyPlayback, resumeSpotifyPlayback } from "@/lib/spotify.functions";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ROAD: Record<Road, { name: string }> = {
  vibe: { name: "Vibe Road" },
  era: { name: "Era Road" },
  mixed: { name: "New Angle" },
};

function Art({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  if (src) {
    return <img src={src} alt={alt} className={cn("shrink-0 rounded-md object-cover", className)} />;
  }
  return (
    <div
      aria-hidden
      className={cn("shrink-0 rounded-md border bg-surface", className)}
    />
  );
}

/** Visual "maze solver": the path walked so far, and the two doors ahead. */
export function PathMaze() {
  const { radio, upNext, upSkip, spotifyIdle, sessionLive, calming, foreignQueued, musicPlaying } = useRadio();

  return (
    <div className="border-b px-4 py-4">
      <div className="flex items-center gap-2">
        <Route className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-bold uppercase tracking-wider">The maze</h3>
      </div>
      <p className="mt-1.5 min-h-[3.75rem] text-xs leading-relaxed text-muted-foreground">
        Every song is a junction. Finish it → Crate keeps walking the same road. Skip it → Crate
        turns. Two skips → a new angle. Lessons are written to Walrus.
      </p>

      {!radio.active || !radio.current ? (
        <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Start a song to enter the maze.
        </p>
      ) : (
        <div className="mt-4 space-y-0">
          {sessionLive && spotifyIdle && !calming && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <span>
                Spotify isn't playing — open Spotify and press play. The maze waits until music is on.
              </span>
            </div>
          )}
          {foreignQueued > 0 && !calming && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <span>
                You have {foreignQueued} song{foreignQueued === 1 ? "" : "s"} in Spotify's "Next in queue" — they
                play before Crate's picks. Clear the queue in Spotify so skips follow the maze.
              </span>
            </div>
          )}
          {calming && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                Cool your jets — Crate needs a moment to catch his breath. Spotify is paused and
                the maze restarts fresh once the new songs are ready.
              </span>
            </div>
          )}
          <JunctionTree
            current={radio.current}
            road={radio.road}
            consecutiveSkips={radio.consecutiveSkips}
            upNext={upNext}
            upSkip={upSkip}
            musicPlaying={musicPlaying}
            controlsEnabled={sessionLive && !calming}
          />

        </div>
      )}
    </div>
  );
}

const TREE_EASE = [0.22, 1, 0.36, 1] as const;
const LEVEL_GAP = 160;

type TreeSnapshot = {
  current: RadioTrack;
  road: Road;
  consecutiveSkips: number;
  upNext: RadioTrack | null;
  upSkip: { track: RadioTrack; road: Road } | null;
};

type TreeAnim =
  | { type: "promote"; side: "left" | "right" }
  | { type: "reset-out" }
  | { type: "reset-in" }
  | null;

/**
 * JunctionTree — the living maze diagram. The playing song sits on top (O),
 * with two curved branches growing down to the Era/Vibe doors. Purely visual:
 * it only renders playback state, never changes it.
 */
function JunctionTree({
  current,
  road,
  consecutiveSkips,
  upNext,
  upSkip,
  musicPlaying,
  controlsEnabled,
}: TreeSnapshot & { musicPlaying: boolean; controlsEnabled: boolean }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<TreeSnapshot>({ current, road, consecutiveSkips, upNext, upSkip });
  const [anim, setAnim] = useState<TreeAnim>(null);
  const latest = useRef<TreeSnapshot>({ current, road, consecutiveSkips, upNext, upSkip });
  latest.current = { current, road, consecutiveSkips, upNext, upSkip };
  const timers = useRef<number[]>([]);

  const box = useRef<HTMLDivElement>(null);
  const oRef = useRef<HTMLDivElement>(null);
  const lRef = useRef<HTMLDivElement>(null);
  const rRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ w: number; oH: number; dH: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (!box.current) return;
      setGeo({
        w: box.current.clientWidth,
        oH: oRef.current?.offsetHeight ?? 0,
        dH: Math.max(lRef.current?.offsetHeight ?? 0, rRef.current?.offsetHeight ?? 0),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [box.current, oRef.current, lRef.current, rRef.current]) {
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [shown, anim]);

  // React to a new confirmed playing song. The cause (finish / skip / external)
  // decides the animation type — never the track id alone.
  useEffect(() => {
    const id = current.spotify_id;
    if (id === shown.current.spotify_id) {
      // Same O, doors may have arrived or changed.
      setShown((s) => ({ ...s, upNext, upSkip, road, consecutiveSkips }));
      return;
    }
    const side: "left" | "right" | null =
      id === shown.upNext?.spotify_id ? "left" : id === shown.upSkip?.track.spotify_id ? "right" : null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const commit = () => setShown({ ...latest.current });
    if (reduced) {
      setAnim(null);
      commit();
      return;
    }
    if (side) {
      setAnim({ type: "promote", side });
      timers.current.push(
        window.setTimeout(() => {
          commit();
          setAnim(null);
        }, 180 + 650),
      );
    } else {
      setAnim({ type: "reset-out" });
      timers.current.push(
        window.setTimeout(() => {
          commit();
          setAnim({ type: "reset-in" });
          timers.current.push(window.setTimeout(() => setAnim(null), 380));
        }, 280),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.spotify_id]);

  // Doors arriving (or changing) while the same song keeps playing: show them
  // immediately. Mid-animation arrivals are picked up by commit() via `latest`.
  useEffect(() => {
    setShown((s) =>
      s.current.spotify_id === current.spotify_id
        ? { ...s, upNext, upSkip, road, consecutiveSkips }
        : s,
    );
  }, [upNext, upSkip, road, consecutiveSkips, current.spotify_id]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const w = geo?.w ?? 0;
  const oH = geo?.oH ?? 0;
  const dH = geo?.dH ?? 0;
  const oW = Math.min(300, Math.max(0, w - 64));
  const doorW = Math.min(220, Math.max(130, w / 2 - 40));
  const oX = (w - oW) / 2;
  const lX = w / 4 - doorW / 2;
  const rX = (3 * w) / 4 - doorW / 2;
  const doorsTop = oH + LEVEL_GAP;
  const ready = geo !== null && w > 0 && oH > 0;

  const skipRoad = shown.upSkip?.road ?? (shown.consecutiveSkips >= 1 ? "mixed" : shown.road === "vibe" ? "era" : "vibe");
  const promoting = anim?.type === "promote" ? anim.side : null;
  const resetting = anim?.type === "reset-out";

  const branch = (tx: number, color: string, grownKey: string, delay: number, dim: boolean) => (
    <motion.path
      key={grownKey}
      d={`M ${w / 2} ${oH} C ${w / 2} ${oH + LEVEL_GAP / 2}, ${tx} ${doorsTop - LEVEL_GAP / 2}, ${tx} ${doorsTop}`}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      initial={reduced ? false : { pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.55, delay, ease: TREE_EASE }}
      style={{ opacity: dim ? 0.35 : 1 }}
    />
  );

  return (
    <motion.div
      ref={box}
      className="relative mt-1"
      style={{ height: ready ? doorsTop + dH : undefined }}
      initial={false}
      animate={resetting ? { scale: 0.88, opacity: 0 } : { scale: 1, opacity: 1 }}
      transition={{ duration: resetting ? 0.28 : 0.32, ease: TREE_EASE }}
    >
      {ready && (
        <svg className="pointer-events-none absolute inset-0" width={w} height={doorsTop + dH} aria-hidden>
          {branch(w / 4, "var(--primary)", `L-${shown.upNext?.spotify_id ?? "none"}`, 0, !shown.upNext)}
          {branch((3 * w) / 4, "var(--accent)", `R-${shown.upSkip?.track.spotify_id ?? "none"}`, 0.07, !shown.upSkip)}
          {/* light pulse along the chosen branch */}
          {promoting && (
            <motion.path
              d={`M ${w / 2} ${oH} C ${w / 2} ${oH + LEVEL_GAP / 2}, ${promoting === "left" ? w / 4 : (3 * w) / 4} ${doorsTop - LEVEL_GAP / 2}, ${promoting === "left" ? w / 4 : (3 * w) / 4} ${doorsTop}`}
              fill="none"
              stroke={promoting === "left" ? "var(--primary)" : "var(--accent)"}
              strokeWidth={4}
              strokeLinecap="round"
              initial={{ opacity: 0.9 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            />
          )}
        </svg>
      )}

      {/* O — the currently playing song */}
      <motion.div
        ref={oRef}
        className="absolute top-0"
        style={{ left: oX, width: oW }}
        initial={anim?.type === "reset-in" && !reduced ? { scale: 0.96, opacity: 0 } : false}
        animate={{ scale: 1, opacity: promoting ? 0 : 1 }}
        transition={{ duration: promoting ? 0.3 : 0.32, ease: TREE_EASE }}
      >
        <div className="relative rounded-xl border border-primary/40 bg-primary/5 p-3.5">
          <div className="flex items-center gap-2 pr-7 text-[11px] font-medium uppercase tracking-wide text-primary">
            <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn("eq-bar w-[2px] rounded-full bg-primary", !musicPlaying && "opacity-60")}
                  style={{
                    height: musicPlaying ? "100%" : "35%",
                    animationDelay: `${i * 0.15}s`,
                    animationDuration: `${0.7 + i * 0.12}s`,
                    animationPlayState: musicPlaying ? "running" : "paused",
                  }}
                />
              ))}
            </span>
            You are here · {ROAD[shown.road].name}
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <Art src={shown.current.image_url} alt={shown.current.name} className="h-14 w-14" />
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{shown.current.name}</div>
              <div className="truncate text-sm text-muted-foreground">{shown.current.artists}</div>
            </div>
          </div>
          {shown.current.why && (
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Why Crate chose it:</span> {shown.current.why}
            </p>
          )}
          <MediaControls musicPlaying={musicPlaying} disabled={!controlsEnabled} />
          <SongNote key={shown.current.spotify_id} trackName={shown.current.name} artists={shown.current.artists} />
        </div>
      </motion.div>

      {/* Doors */}
      <motion.div
        ref={lRef}
        className="absolute"
        style={{ left: lX, top: doorsTop, width: doorW }}
        key={`doorL-${shown.upNext?.spotify_id ?? "none"}`}
        initial={reduced ? false : { opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: promoting === "left" ? 0 : 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, delay: promoting ? 0 : 0.37, ease: TREE_EASE }}
      >
        <Door
          tone="keep"
          label="Keep walking"
          sublabel="if you finish"
          road={shown.road}
          title={shown.upNext?.name}
          artists={shown.upNext?.artists}
          image={shown.upNext?.image_url}
          icon={<Check className="h-3 w-3" />}
        />
      </motion.div>
      <motion.div
        ref={rRef}
        className="absolute"
        style={{ left: rX, top: doorsTop, width: doorW }}
        key={`doorR-${shown.upSkip?.track.spotify_id ?? "none"}`}
        initial={reduced ? false : { opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: promoting ? 0 : 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, delay: promoting ? 0 : 0.37, ease: TREE_EASE }}
      >
        <Door
          tone="turn"
          label="Take a turn"
          sublabel="if you skip"
          road={skipRoad}
          title={shown.upSkip?.track.name}
          artists={shown.upSkip?.track.artists}
          image={shown.upSkip?.track.image_url}
          icon={<SkipForward className="h-3 w-3" />}
        />
      </motion.div>

      {/* Travelling clone: the chosen door gliding up to O's position */}
      {promoting && ready && (
        <motion.div
          className="pointer-events-none absolute z-10"
          initial={{
            x: promoting === "left" ? lX : rX,
            y: doorsTop,
            width: doorW,
            opacity: 1,
          }}
          animate={{ x: oX, y: 0, width: oW, opacity: 1 }}
          transition={{ duration: 0.65, delay: 0.18, ease: TREE_EASE }}
        >
          <div className="rounded-xl border border-primary/40 bg-surface p-3 shadow-lg">
            <div className="flex items-center gap-2.5">
              <Art
                src={promoting === "left" ? shown.upNext?.image_url : shown.upSkip?.track.image_url}
                alt=""
                className="h-10 w-10"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {promoting === "left" ? shown.upNext?.name : shown.upSkip?.track.name}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {promoting === "left" ? shown.upNext?.artists : shown.upSkip?.track.artists}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

const TAG: Record<string, { label: string; cls: string }> = {
  start: { label: "START", cls: "text-primary" },
  think: { label: "THINK", cls: "text-muted-foreground" },
  door: { label: "DOOR", cls: "text-primary" },
  pick: { label: "PICK", cls: "text-primary" },
  finish: { label: "DONE", cls: "text-primary" },
  skip: { label: "SKIP ", cls: "text-destructive" },
  reroot: { label: "ROOT ", cls: "text-primary" },
  steer: { label: "STEER", cls: "text-foreground" },
};

/**
 * CrateConsole — pinned to the very bottom of the Walrus column. Collapsed
 * it's a single bar; expanding slides the bar up while the console unfolds
 * below it, showing Crate's live reasoning as it walks the maze.
 */
export function CrateConsole({
  open,
  setOpen,
  onAnimatingChange,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onAnimatingChange?: (v: boolean) => void;
}) {
  const { events, radio } = useRadio();
  const ref = useRef<HTMLDivElement>(null);
  const [collapsing, setCollapsing] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [collapseH, setCollapseH] = useState<number | null>(null);
  const [panelH, setPanelH] = useState<number | null>(null);

  // Lock the log to its final height so the text stays still and simply
  // gets revealed (or hidden) as the bar moves.
  useLayoutEffect(() => {
    if (!open) return;
    const g = gridRef.current;
    if (!g) return;
    const measure = () => {
      if (!collapsingRef.current) setPanelH(g.clientHeight);
    };
    measure();
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    const ro = new ResizeObserver(measure);
    ro.observe(g);
    return () => ro.disconnect();
  }, [open]);
  const collapsingRef = useRef(false);
  const expanded = open && !collapsing;

  // Keep the log pinned to the newest line — also while it grows during the
  // expand animation, so text is "pulled up" from below.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const ro = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, open, panelH]);

  const toggle = () => {
    if (collapsing) return;
    if (!open) return setOpen(true);
    // Animate closed while the layout still reserves space, then release it.
    const h = gridRef.current?.getBoundingClientRect().height ?? 0;
    setCollapseH(h);
    collapsingRef.current = true;
    setCollapsing(true);
    onAnimatingChange?.(true);
    setOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setCollapseH(0)));
    window.setTimeout(() => {
      setCollapseH(null);
      collapsingRef.current = false;
      setCollapsing(false);
      onAnimatingChange?.(false);
    }, 500);
  };

  const live = radio.active;

  return (
    <div className={cn("flex flex-col border-t", expanded ? "min-h-0 flex-1" : "min-h-0 shrink-0")}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-accent/50"
      >
        <MessagesSquare className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold uppercase tracking-wider">Crate console</span>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
          {events.length > 0 && <span>{events.length} steps</span>}
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>
      <div
        ref={gridRef}
        style={collapseH !== null ? { height: collapseH } : undefined}
        className={cn(
          "grid min-h-0 transition-all duration-500 ease-in-out",
          expanded && "flex-1",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={ref}
            style={panelH ? { height: panelH } : undefined}
            className="scrollbar-thin space-y-2 overflow-y-auto px-4 pb-4 text-xs leading-relaxed"
          >
            {!live && events.length === 0 ? (
              <div className="text-muted-foreground">
                Start a session to follow how Crate makes its decisions.
              </div>
            ) : (
              <>
                {events.length === 0 && (
                  <div className="text-muted-foreground">Waiting for Crate…</div>
                )}
                {events.map((e, i) => {
                  const t = TAG[e.kind] ?? TAG["think"]!;
                  return (
                    <div key={e.at + "-" + i} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                        {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide",
                          t.cls
                        )}
                      >
                        {t.label}
                      </span>
                      <span className={cn("min-w-0 break-words", e.kind === "think" ? "text-muted-foreground" : "text-foreground")}>
                        {e.text}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventIcon({ kind }: { kind: string }) {
  const cls = "mt-0.5 h-3.5 w-3.5 shrink-0";
  if (kind === "finish") return <Check className={cn(cls, "text-primary")} />;
  if (kind === "skip") return <SkipForward className={cn(cls, "text-muted-foreground")} />;
  if (kind === "pick") return <Sparkles className={cn(cls, "text-primary")} />;
  if (kind === "reroot") return <GitBranch className={cn(cls, "text-primary")} />;
  return <Flag className={cn(cls, "text-primary")} />;
}

/** Optional one-off note about the playing song, saved to Walrus Memory. */
function SongNote({ trackName, artists }: { trackName: string; artists: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    const text = note.trim();
    if (!text || saved) return;
    await addMemory({
      data: {
        kind: "mood_trigger",
        content: `Note on "${trackName}" by ${artists}: ${text}`,
        origin: "button",
      },
    });
    setSaved(true);
    setNote("");
    setTimeout(() => {
      setSaved(false);
      setOpen(false);
      setDone(true);
    }, 1600);
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-onboarding="feedbacker"
              onClick={() => {
                if (!open) setOpen(true);
              }}
              aria-label={done ? "Note saved — add another" : "Feedbacker"}
              title={done ? "Note saved — add another" : "Feedbacker"}
              className={cn(
                "absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary",
                done && !open && "text-primary",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : <NotebookPen className="h-3.5 w-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Feedbacker</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {open && (
        <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder='What does this song make you feel?'
            maxLength={200}
            className="w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {saved
              ? "Saved to Walrus Memory ✓"
              : "A couple of words is plenty — Walrus learns your puzzle either way. Enter to save · Esc to close"}
          </p>
        </div>
      )}
    </>
  );
}

/** Pause/resume and next-song controls, right inside the current song box. */
function MediaControls({ musicPlaying, disabled }: { musicPlaying: boolean; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  // Flip the icon instantly on click; drop the override once Spotify reports the same state.
  const [shown, setShown] = useState<boolean | null>(null);
  useEffect(() => {
    if (shown === null) return;
    if (shown === musicPlaying) { setShown(null); return; }
    const t = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(t);
  }, [shown, musicPlaying]);
  const playing = shown ?? musicPlaying;
  const pauseFn = useServerFn(pauseSpotifyPlayback);
  const resumeFn = useServerFn(resumeSpotifyPlayback);
  const { skipNow: nextFn } = useRadio();

  const run = async (fn: () => Promise<unknown>) => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex items-center gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground hover:text-foreground"
              disabled={disabled || busy}
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => { if (busy || disabled) return; setShown(!playing); void run(playing ? pauseFn : resumeFn).catch(() => setShown(null)); }}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{playing ? "Pause" : "Play"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground hover:text-foreground"
              disabled={disabled || busy}
              aria-label="Next song"
              onClick={() => void run(nextFn)}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Next song</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function Door({
  label,
  sublabel,
  tone,
  road,
  title,
  artists,
  image,
  icon,
}: {
  label: string;
  sublabel: string;
  tone: "keep" | "turn";
  road: Road;
  title?: string | undefined;
  artists?: string | undefined;
  image?: string | null | undefined;
  icon: React.ReactNode;
}) {
  const keep = tone === "keep";
  return (
    <div
      className={cn(
        "rounded-xl border bg-surface p-3",
        keep ? "border-primary/40" : "border-magenta/40",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide",
          keep ? "text-primary" : "text-magenta",
        )}
      >
        <span className="grid shrink-0 place-items-center">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{sublabel}</div>
      <div className="mt-2 flex items-center gap-2.5">
        <Art src={image ?? null} alt={title ?? label} className="h-10 w-10" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title ?? "Finding…"}</div>
          {artists && <div className="truncate text-[11px] text-muted-foreground">{artists}</div>}
        </div>
      </div>
      <div className="mt-2 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
        <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
        <span>{ROAD[road].name}</span>
      </div>
    </div>
  );
}

