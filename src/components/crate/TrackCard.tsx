import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Heart, Play, SkipForward, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { addMemory } from "@/lib/memory.functions";
import { cn } from "@/lib/utils";

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
  const [playing, setPlaying] = useState(false);
  const [acted, setActed] = useState<null | "fav" | "skip">(null);
  const remember = useServerFn(addMemory);
  const qc = useQueryClient();
  const canEmbed = track.spotify_id && !track.spotify_id.startsWith("demo-");

  async function act(kind: "favorite" | "skipped") {
    setActed(kind === "favorite" ? "fav" : "skip");
    try {
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
        kind === "favorite" ? "Saved to your taste memory" : "Won't suggest that again",
      );
    } catch (e) {
      setActed(null);
      toast.error(e instanceof Error ? e.message : "Couldn't save memory");
    }
  }

  return (
    <div
      className={cn(
        "group rounded-xl border bg-surface p-3 transition hover:bg-surface-2",
        acted === "skip" && "opacity-50",
      )}
    >
      <div className="flex gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-primary/60 to-magenta/60">
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
        <div className="flex shrink-0 flex-col gap-1">
          <button
            aria-label="Play preview"
            onClick={() => (onPlay ? onPlay() : setPlaying((p) => !p))}
            disabled={!canEmbed && !track.preview_url}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:scale-105 disabled:opacity-30"
          >
            <Play className="h-4 w-4 fill-current" />
          </button>
          {track.spotify_url && (
            <a
              href={track.spotify_url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in Spotify"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
      {track.reason && (
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{track.reason}</p>
      )}
      {playing &&
        (canEmbed ? (
          <iframe
            title={`${track.name} preview`}
            src={`https://open.spotify.com/embed/track/${track.spotify_id}?theme=0`}
            className="mt-3 h-20 w-full rounded-lg"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
          />
        ) : track.preview_url ? (
          <audio src={track.preview_url} controls autoPlay className="mt-3 w-full" />
        ) : null)}
      <div className="mt-3 flex justify-end gap-1">
        <button
          onClick={() => act("favorite")}
          disabled={acted !== null}
          aria-label="Still love it"
          title="Still love it"
          className={cn(
            "rounded-full p-1.5 text-muted-foreground transition hover:text-primary disabled:pointer-events-none",
            acted === "fav" && "text-primary",
          )}
        >
          <Heart className={cn("h-3.5 w-3.5", acted === "fav" && "fill-current")} />
        </button>
        <button
          onClick={() => act("skipped")}
          disabled={acted !== null}
          aria-label="Don't suggest this again"
          title="Don't suggest this again"
          className="rounded-full p-1.5 text-muted-foreground transition hover:text-foreground disabled:pointer-events-none"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
