import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Heart, Play, SkipForward, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { addMemory } from "@/lib/memory.functions";
import { logListeningEvent } from "@/lib/radio.functions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { motion, useReducedMotion } from "motion/react";
import { geometricEnter, reducedFade } from "@/lib/motion";

export type CardTrack = {
  id: string;
  name: string;
  artists: string;
  album?: string | null;
  image_url?: string | null;
  preview_url?: string | null;
  spotify_url?: string | null;
  spotify_id?: string | null;
  source_name: string;
  source_type?: string;
  period_label?: string;
  reason?: string;
};


export function TrackCard({
  track,
  index,
  onPlay,
}: {
  track: CardTrack;
  index: number;
  onPlay?: () => void;
}) {
  const [acted, setActed] = useState<null | "fav" | "skip">(null);
  const reduced = useReducedMotion();
  const remember = useServerFn(addMemory);
  const logEvent = useServerFn(logListeningEvent);
  const qc = useQueryClient();
  const canEmbed = track.spotify_id && !track.spotify_id.startsWith("demo-");

  async function act(kind: "favorite" | "skipped") {
    setActed(kind === "favorite" ? "fav" : "skip");
    try {
      if (kind === "skipped") {
        // A rest for a few sessions, never a permanent block.
        await logEvent({
          data: { trackId: null, trackName: track.name, artists: track.artists, event: "explicit_skip", sessionId: `cards-${new Date().toISOString().slice(0, 10)}`, mode: null },
        });
      } else
        await remember({
        data: {
          kind,
          content:
            kind === "favorite"
              ? `Loved "${track.name}" by ${track.artists} when it resurfaced.`
              : `Skipped "${track.name}" by ${track.artists} — don't resurface it for now.`,
        },
      });
      qc.invalidateQueries({ queryKey: ["memories"] });
      toast.success(
        kind === "favorite" ? "Saved to your taste memory" : "Resting it for a few sessions",
      );
    } catch (e) {
      setActed(null);
      toast.error(e instanceof Error ? e.message : "Couldn't save memory");
    }
  }

  return (
    <motion.div
      variants={reduced ? reducedFade : geometricEnter}
      layout="position"
      className={cn(
        "group rounded-lg border bg-surface p-2 transition hover:bg-surface-2",
        acted === "skip" && "opacity-50",
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-linear-to-br from-primary/60 to-magenta/60">
          {track.image_url ? (
            <img
              src={track.image_url}
              alt={track.album ?? track.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-display text-xl font-bold text-primary-foreground">
              {track.name.slice(0, 1)}
            </div>
          )}
          <span className="absolute left-1 top-1 rounded bg-background/80 px-1 text-[10px] font-bold">
            {index + 1}
          </span>
        </div>
        <div className="min-w-0 flex-1 self-start pt-1">
          <div className="truncate font-semibold">{track.name}</div>
          <div className="truncate text-sm text-muted-foreground">{track.artists}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onPlay && (
          <Button
            aria-label="Play on Spotify"
            onClick={onPlay}
            disabled={!canEmbed || !onPlay}
            size="icon-lg"
            className="rounded-full transition-transform hover:scale-105 disabled:opacity-30"
          >
            <Play className="h-5 w-5 fill-current" />
          </Button>
          )}
          {track.spotify_url && (
            <Button asChild variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground">
              <a href={track.spotify_url} target="_blank" rel="noreferrer" aria-label="Open in Spotify">
                <ExternalLink className="h-4.5 w-4.5" />
              </a>
            </Button>
          )}
          <Button
            onClick={() => act("favorite")}
            disabled={acted !== null}
            aria-label="Still love it"
            title="Still love it"
            variant="ghost"
            size="icon-sm"
            className={cn("rounded-full text-muted-foreground hover:text-primary", acted === "fav" && "text-primary")}
          >
            <Heart className={cn("h-4.5 w-4.5", acted === "fav" && "fill-current")} />
          </Button>
          <Button
            onClick={() => act("skipped")}
            disabled={acted !== null}
            aria-label="Don't suggest this again"
            title="Don't suggest this again"
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            <SkipForward className="h-4.5 w-4.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
