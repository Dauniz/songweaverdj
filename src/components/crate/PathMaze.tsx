import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, CornerDownRight, Flag, GitBranch, MessagesSquare, NotebookPen, Route, SkipForward, Sparkles } from "lucide-react";
import { useRadio, type Road } from "@/components/crate/radio-context";
import { addMemory } from "@/lib/memory.functions";
import { cn } from "@/lib/utils";

const ROAD: Record<Road, { name: string; rule: string }> = {
  vibe: { name: "Vibe road", rule: "same feeling & sound" },
  era: { name: "Era road", rule: "same playlist & months" },
  mixed: { name: "New angle", rule: "fresh direction + your memory" },
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
  const { radio, upNext, upSkip, spotifyIdle, sessionLive } = useRadio();

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
          {sessionLive && spotifyIdle && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <span>
                Spotify isn't playing — open Spotify and press play. The maze waits until music is on.
              </span>
            </div>
          )}
          {radio.history.slice(-4).map((h, i) => (
            <div key={i} className="flex items-center gap-3 border-l-2 border-muted py-1.5 pl-3.5 text-sm">
              {h.outcome === "played" ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
                  <Check className="h-3 w-3 shrink-0 text-primary" />
                </span>
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
                  <SkipForward className="h-3 w-3 shrink-0 text-muted-foreground" />
                </span>
              )}
              <span className="min-w-0">
                <span className={cn("block truncate", h.outcome === "skipped" && "text-muted-foreground line-through")}>
                  {h.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{h.artists}</span>
              </span>
            </div>
          ))}

          <div className="rounded-xl border border-primary/40 bg-primary/5 p-3.5">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-primary">
              <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="eq-bar w-[2px] rounded-full bg-primary"
                    style={{ height: "100%", animationDelay: `${i * 0.15}s`, animationDuration: `${0.7 + i * 0.12}s` }}
                  />
                ))}
              </span>
              You are here · {ROAD[radio.road].name}
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <Art src={radio.current.image_url} alt={radio.current.name} className="h-14 w-14" />
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{radio.current.name}</div>
                <div className="truncate text-sm text-muted-foreground">{radio.current.artists}</div>
              </div>
            </div>
            {radio.current.why && (
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Why Crate chose it:</span> {radio.current.why}
              </p>
            )}
            <SongNote key={radio.current.spotify_id} trackName={radio.current.name} artists={radio.current.artists} />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3">
            <Door
              label="If you finish"
              road={radio.road}
              title={upNext?.name}
              artists={upNext?.artists}
              image={upNext?.image_url}
              icon={<Check className="h-3 w-3 text-primary" />}
            />
            <Door
              label="If you skip"
              road={upSkip?.road ?? (radio.consecutiveSkips >= 1 ? "mixed" : radio.road === "vibe" ? "era" : "vibe")}
              title={upSkip?.track.name}
              artists={upSkip?.track.artists}
              image={upSkip?.track.image_url}
              icon={<SkipForward className="h-3 w-3" />}
            />
          </div>
        </div>
      )}
    </div>
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
 * Decisionmaking — lives at the bottom of the Walrus column. Collapsed it's a
 * single row; expanded it grows to fill the column and shows Crate's live
 * reasoning as it walks the maze.
 */
export function Decisionmaking() {
  const { events, radio } = useRadio();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, open]);

  const live = radio.active;

  return (
    <div className={cn("flex min-h-0 flex-col border-t", open ? "flex-1" : "shrink-0")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-accent/50"
      >
        <MessagesSquare className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold uppercase tracking-wider">Decisionmaking</span>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
          {events.length > 0 && <span>{events.length} steps</span>}
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div
          ref={ref}
          className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 text-xs leading-relaxed"
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
      )}
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

  if (!open && done) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <Check className="h-3 w-3 text-primary" /> Note saved to Walrus · add another
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-start gap-2.5 rounded-lg border border-border bg-surface p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
      >
        <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Feedbacker</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            Your feelings on this song teach Walrus the maze — helping it adapt to you over time.
          </span>
        </span>
      </button>
    );
  }

  return (
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
  );
}

function Door({
  label,
  road,
  title,
  artists,
  image,
  icon,
}: {
  label: string;
  road: Road;
  title?: string | undefined;
  artists?: string | undefined;
  image?: string | null | undefined;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <Art src={image ?? null} alt={title ?? label} className="h-10 w-10" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title ?? "Finding…"}</div>
          {artists && <div className="truncate text-[11px] text-muted-foreground">{artists}</div>}
        </div>
      </div>
      <div className="mt-2 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
        <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          {ROAD[road].name}: {ROAD[road].rule}
        </span>
      </div>
    </div>
  );
}
