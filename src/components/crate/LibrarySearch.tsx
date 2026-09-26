import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRadio } from "./radio-context";
import type { CardTrack } from "./TrackCard";

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
  let s = 0;
  if (n === q) s += 100;
  if (a.split(/,\s*/).some((x) => x === q)) s += 90;
  if (n.startsWith(q)) s += 50;
  if (a.startsWith(q) || a.split(/[\s,]+/).some((w) => w.startsWith(q))) s += 45;
  if (n.split(/\s+/).some((w) => w.startsWith(q))) s += 30;
  if (n.includes(q)) s += 10;
  if (a.includes(q)) s += 10;
  return s;
}

export function LibrarySearch() {
  const { startRadio } = useRadio();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

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
    startRadio([track], "");
    setQ("");
  }

  const open = debounced.length >= 2;

  return (
    <div className="relative">
      <div className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 focus-within:border-primary">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) play(results[0]);
            if (e.key === "Escape") setQ("");
          }}
          placeholder="Search your library — songs, artists, albums"
          aria-label="Search your library"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">{isFetching ? "Searching…" : "No songs found"}</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => play(r)}
                className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent"
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
            ))
          )}
        </div>
      )}
    </div>
  );
}
