import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { ListPlus, Play, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRadio } from "./radio-context";
import type { CardTrack } from "./TrackCard";
import { geometricEnter, reducedFade, staggerChildren } from "@/lib/motion";

type Row = {
  id: string;
  spotify_id: string;
  name: string;
  artists: string;
  album: string | null;
  image_url: string | null;
  spotify_url: string | null;
  source_name: string;
};

function score(row: Row, q: string) {
  const n = row.name.toLowerCase();
  const a = row.artists.toLowerCase();
  const main = a.split(/,\s*/)[0] ?? "";
  let s = 0;
  // Songs where the searched artist is the main artist come first.
  if (main === q) s += 120;
  else if (main.startsWith(q) || main.split(/\s+/).some((w) => w.startsWith(q))) s += 70;
  if (n === q) s += 100;
  if (a.split(/,\s*/).some((x) => x === q)) s += 90;
  if (n.startsWith(q)) s += 50;
  if (a.startsWith(q) || a.split(/[\s,]+/).some((w) => w.startsWith(q))) s += 45;
  if (n.split(/\s+/).some((w) => w.startsWith(q))) s += 30;
  if (n.includes(q)) s += 10;
  if (a.includes(q)) s += 10;
  return s;
}

export function LibrarySearch({ onSelect }: { onSelect?: () => void }) {
  const reduced = useReducedMotion();
  const { rerootTo, queueTrack, sessionLive } = useRadio();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setDismissed(true);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["library-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const term = debounced.replace(/[%_,()]/g, " ").trim();
      const { data, error } = await supabase
        .from("library_tracks")
        .select("id, spotify_id, name, artists, album, image_url, spotify_url, source_name")
        .or(`name.ilike.%${term}%,artists.ilike.%${term}%,album.ilike.%${term}%`)
        .limit(200);
      if (error) throw error;
      const seen = new Set<string>();
      const low = term.toLowerCase();
      return (data as Row[])
        .filter((r) => (seen.has(r.spotify_id) ? false : (seen.add(r.spotify_id), true)))
        .sort((x, y) => score(y, low) - score(x, low))
        .slice(0, 12);
    },
  });

  function play(row: Row) {
    const track: CardTrack = { ...row };
    rerootTo(track);
    setQ("");
    onSelect?.();
  }

  function queue(row: Row) {
    queueTrack({ ...row });
    setQ("");
    onSelect?.();
  }

  const open = debounced.length >= 2 && !dismissed;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex h-14 items-center gap-2 rounded-md border border-input bg-surface/90 px-4 shadow-sm focus-within:border-primary">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setDismissed(false); }}
          onFocus={() => setDismissed(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) play(results[0]);
            if (e.key === "Escape") setQ("");
          }}
          placeholder={sessionLive ? "Tailor your session with a specific song" : "Start of your session with a specific song"}
          aria-label={sessionLive ? "Tailor your session with a specific song" : "Start of your session with a specific song"}
          className="min-w-0 flex-1 bg-transparent text-lg leading-7 text-foreground outline-none placeholder:text-base placeholder:text-muted-foreground"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="kinetic-control text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <AnimatePresence>
      {open && (
        <motion.div
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={reduced ? reducedFade : geometricEnter}
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-lg"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">{isFetching ? "Searching…" : "No results in your library"}</p>
          ) : (
            <motion.div variants={staggerChildren} initial="hidden" animate="visible">
            {results.map((r) => (
              <motion.div key={r.id} variants={reduced ? reducedFade : geometricEnter} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => play(r)}
                className="kinetic-control group flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent"
              >
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
                  {r.image_url && <img src={r.image_url} alt="" className="h-full w-full object-cover" />}
                  <span className="absolute inset-0 hidden place-items-center bg-background/60 group-hover:grid">
                    <Play className="h-4 w-4 fill-current text-foreground" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.artists}</p>
                </div>
              </button>
              {sessionLive && (
                <button
                  type="button"
                  onClick={() => queue(r)}
                  aria-label={`Queue ${r.name}`}
                  title="Queue: plays next, finish or skip"
                  className="kinetic-control flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ListPlus className="h-4 w-4" /> Queue
                </button>
              )}
              </motion.div>
            ))}
            </motion.div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
