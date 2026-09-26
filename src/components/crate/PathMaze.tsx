import { useState } from "react";
import { AlertTriangle, Check, CornerDownRight, Flag, GitBranch, NotebookPen, Route, SkipForward, Sparkles } from "lucide-react";
import { useRadio, type Road } from "@/components/crate/radio-context";
import { addMemory } from "@/lib/memory.functions";
import { cn } from "@/lib/utils";

const ROAD: Record<Road, { name: string; rule: string }> = {
  vibe: { name: "Vibe road", rule: "same feeling & sound" },
  era: { name: "Era road", rule: "same playlist & months" },
  mixed: { name: "New angle", rule: "fresh direction + your memory" },
};

/** Visual "maze solver": the path walked so far, and the two doors ahead. */
export function PathMaze() {
  const { radio, upNext, upSkip, events, spotifyIdle, sessionLive } = useRadio();

  return (
    <div className="border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <Route className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-bold uppercase tracking-wider">The maze</h3>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Every song is a junction. Finish it → Crate keeps walking the same road. Skip it → Crate
        turns. Two skips → a new angle. Lessons are written to Walrus.
      </p>

      {!radio.active || !radio.current ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Start a song to enter the maze.
        </p>
      ) : (
        <div className="mt-3 space-y-0">
          {sessionLive && spotifyIdle && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <span>
                Spotify isn't playing — open Spotify and press play. The maze waits until music is on.
              </span>
            </div>
          )}
          {radio.history.slice(-4).map((h, i) => (
            <div key={i} className="flex items-center gap-2 border-l-2 border-muted pl-3 py-1 text-xs">
              {h.outcome === "played" ? (
                <Check className="h-3 w-3 shrink-0 text-primary" />
              ) : (
                <SkipForward className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className={cn("truncate", h.outcome === "skipped" && "text-muted-foreground line-through")}>
                {h.name}
              </span>
            </div>
          ))}

          <div className="rounded-lg border border-primary/40 bg-primary/5 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-primary">
              <span className="flex h-3 items-end gap-[2px]" aria-hidden>
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
            <div className="truncate text-sm font-semibold">{radio.current.name}</div>
            <div className="truncate text-xs text-muted-foreground">{radio.current.artists}</div>
            {radio.current.why && (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                <span className="font-semibold text-foreground">Why Crate chose it:</span> {radio.current.why}
              </p>
            )}
            <SongNote key={radio.current.spotify_id} trackName={radio.current.name} artists={radio.current.artists} />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Door
              label="If you finish"
              road={radio.road}
              title={upNext?.name}
              icon={<Check className="h-3 w-3 text-primary" />}
            />
            <Door
              label="If you skip"
              road={upSkip?.road ?? (radio.consecutiveSkips >= 1 ? "mixed" : radio.road === "vibe" ? "era" : "vibe")}
              title={upSkip?.track.name}
              icon={<SkipForward className="h-3 w-3" />}
            />
          </div>

          {events.length > 0 && (
            <div className="mt-3 rounded-lg border bg-surface p-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Crate's decisions
              </div>
              <ol className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto">
                {[...events].reverse().map((e, i) => (
                  <li key={e.at + "-" + i} className="flex gap-2 text-[11px] leading-snug">
                    <EventIcon kind={e.kind} />
                    <span className="min-w-0 flex-1">{e.text}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventIcon({ kind }: { kind: string }) {
  const cls = "mt-0.5 h-3 w-3 shrink-0";
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
        className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
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
        className="mt-2 flex w-full items-start gap-2 rounded-md border border-border bg-surface p-2 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
      >
        <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block text-xs font-semibold">Feedbacker</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
            Your feelings on this song teach Walrus the maze — helping it adapt to you over time.
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-2">
      <input
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder='e.g. "nostalgi, minne från hälsingegården, högstadiet"'
        maxLength={200}
        className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-primary"
      />
      <p className="mt-1 text-[10px] text-muted-foreground">
        {saved
          ? "Saved to Walrus Memory ✓"
          : "A couple of words is plenty — Walrus learns your puzzle either way. Enter to save · Esc to close"}
      </p>
    </div>
  );
}

function Door({ label, road, title, icon }: { label: string; road: Road; title?: string | undefined; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-surface p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 flex items-start gap-1 text-xs">
        <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{title ?? "Finding…"}</span>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {ROAD[road].name}: {ROAD[road].rule}
      </div>
    </div>
  );
}
