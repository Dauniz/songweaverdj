import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { Play } from "lucide-react";
import { getStudioSuggestions, type StudioSuggestions as Result } from "@/lib/suggestions.functions";
import { useRadio } from "./radio-context";
import { cn } from "@/lib/utils";
import { geometricEnter, reducedFade, staggerChildren } from "@/lib/motion";
import { Button } from "@/components/ui/button";

const partOf = (h: number) => (h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night");

/** Crate's 8 picks on the Studio start screen; play one to start a session from it. */
export function StudioSuggestions({ onPlay }: { onPlay?: () => void }) {
  const fetchSuggestions = useServerFn(getStudioSuggestions);
  const { rerootTo } = useRadio();
  const reduced = useReducedMotion();
  const now = new Date();
  const key = `songweaver-suggest-${now.getDay()}-${partOf(now.getHours())}`;
  const { data } = useQuery({
    queryKey: ["studio-suggestions", key],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<Result> => {
      const cached = sessionStorage.getItem(key);
      if (cached) {
        try { return JSON.parse(cached) as Result; } catch { /* refetch */ }
      }
      const r = await fetchSuggestions({ data: { tzOffsetMin: now.getTimezoneOffset() } });
      if (r.tracks.length) sessionStorage.setItem(key, JSON.stringify(r));
      return r;
    },
  });
  if (!data?.tracks.length) return null;
  return (
    <div className="song-results-reveal mx-auto w-full max-w-4xl">
      <div className="mb-2 text-center font-display text-lg font-bold text-primary sm:text-xl">{data.title}</div>
      <motion.div variants={staggerChildren} initial="hidden" animate="visible" className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-2">
        {data.tracks.map((t, i) => (
          <motion.div
            key={t.spotify_id}
            variants={reduced ? reducedFade : geometricEnter}
            className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-surface p-2 [@media(max-height:720px)]:p-1.5", i >= 4 && "hidden sm:grid")}
          >
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              {t.image_url ? (
                <img src={t.image_url} alt="" className="h-9 w-9 shrink-0 rounded object-cover [@media(max-height:720px)]:h-8 [@media(max-height:720px)]:w-8" />
              ) : (
                <div className="h-9 w-9 shrink-0 rounded bg-surface-2 [@media(max-height:720px)]:h-8 [@media(max-height:720px)]:w-8" />
              )}
              <div className="min-w-0 text-left">
                <div className="truncate text-xs font-semibold sm:text-sm" title={t.name}>{t.name}</div>
                <div className="truncate text-[11px] text-muted-foreground sm:text-xs" title={t.artists}>{t.artists}</div>
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              aria-label={`Start a session with ${t.name}`}
              onClick={() => { rerootTo({ ...t }); onPlay?.(); }}
              className="h-9 w-9 shrink-0 rounded-full transition hover:scale-105 [@media(max-height:720px)]:h-8 [@media(max-height:720px)]:w-8"
            >
              <Play className="h-4 w-4 fill-current" />
            </Button>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
