import { motion, useReducedMotion } from "motion/react";
import { geometricEnter, reducedFade, staggerChildren } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { CardTrack } from "./TrackCard";

/**
 * Crate's ordered picks when a session starts from a prompt.
 * Display-only: one compact chain, no buttons — pausing and skipping live in the maze tab.
 */
export function PromptPlaylist({ title, tracks }: { title: string; tracks: CardTrack[] }) {
  const reduced = useReducedMotion();
  const shown = tracks.slice(0, 6);
  if (!shown.length) return null;

  return (
    <div className="song-results-reveal mx-auto w-full max-w-2xl">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
        <span className="truncate font-display text-sm font-bold text-primary sm:text-base">{title}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{shown.length} songs</span>
      </div>
      <motion.ol
        variants={staggerChildren}
        initial="hidden"
        animate="visible"
        className="overflow-hidden rounded-xl border bg-surface/70"
      >
        {shown.map((t, i) => (
          <motion.li
            key={t.id}
            variants={reduced ? reducedFade : geometricEnter}
            className={cn(
              "grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 px-2.5 py-1.5",
              i > 0 && "border-t border-border/60",
            )}
          >
            <span className="w-3 shrink-0 text-center font-display text-[11px] font-bold tabular-nums text-muted-foreground/70">
              {i + 1}
            </span>
            {t.image_url ? (
              <img
                src={t.image_url}
                alt=""
                loading="lazy"
                className="h-7 w-7 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-linear-to-br from-primary/50 to-magenta/50 font-display text-[11px] font-bold text-primary-foreground">
                {t.name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold leading-5" title={t.name}>
                {t.name}
              </div>
              <div className="truncate text-[11px] leading-4 text-muted-foreground" title={t.artists}>
                {t.artists}
              </div>
            </div>
          </motion.li>
        ))}
      </motion.ol>
    </div>
  );
}
