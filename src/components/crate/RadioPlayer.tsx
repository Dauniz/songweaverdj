import { useEffect, useRef, useState } from "react";
import { Pause, Play, Repeat2, SkipForward, SlidersHorizontal, X } from "lucide-react";
import { SteerChips } from "./SteerChips";
import { useRadio } from "./radio-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type SpotifyController = {
  loadUri: (uri: string) => void;
  play: () => void;
  togglePlay: () => void;
  pause: () => void;
  destroy: () => void;
  addListener: (ev: string, cb: (e: any) => void) => void;
};

let apiPromise: Promise<any> | null = null;
function loadSpotifyApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    (window as any).onSpotifyIframeApiReady = (api: any) => resolve(api);
    const s = document.createElement("script");
    s.src = "https://open.spotify.com/embed/iframe-api/v1";
    s.async = true;
    document.body.appendChild(s);
  });
  return apiPromise;
}

export function RadioPlayer() {
  const { radio, stopRadio, next, upNext, thinking, askSteer, dismissSteer, toggleChip } = useRadio();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [paused, setPaused] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(false);
  const [progress, setProgress] = useState({ position: 0, duration: 0 });

  const current = radio.current;

  const embedHost = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<SpotifyController | null>(null);
  const progressRef = useRef({ position: 0, duration: 0 });
  const endedRef = useRef(false);
  const nextRef = useRef(next);
  nextRef.current = next;
  const useEmbed = Boolean(current?.spotify_id && !current.spotify_id.startsWith("demo-"));
  const active = radio.active && Boolean(current);

  // Create the Spotify controller once the bar is visible
  useEffect(() => {
    if (!active || ctrlRef.current || !embedHost.current) return;
    let cancelled = false;
    const host = document.createElement("div");
    embedHost.current.appendChild(host);
    loadSpotifyApi().then((api) => {
      if (cancelled) return;
      api.createController(host, { width: "100%", height: 80 }, (c: SpotifyController) => {
        ctrlRef.current = c;
        c.addListener("ready", () => {
          const t = currentRef.current;
          if (t?.spotify_id && !t.spotify_id.startsWith("demo-")) {
            c.loadUri(`spotify:track:${t.spotify_id}`);
            c.play();
          }
        });
        c.addListener("playback_update", (e: any) => {
          const { position, duration, isPaused } = e.data ?? {};
          progressRef.current = { position, duration };
          setProgress({ position: Number(position) || 0, duration: Number(duration) || 0 });
          setPaused(Boolean(isPaused));
          if (duration > 0 && position >= duration - 800 && !endedRef.current) {
            endedRef.current = true;
            nextRef.current("played");
          }
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      ctrlRef.current?.destroy();
      ctrlRef.current = null;
      if (embedHost.current) embedHost.current.innerHTML = "";
    }
  }, [active]);

  const currentRef = useRef(current);
  currentRef.current = current;

  // Load + play whenever the current track changes
  useEffect(() => {
    if (!current) return;
    endedRef.current = false;
    progressRef.current = { position: 0, duration: 0 };
    setProgress({ position: 0, duration: 0 });
    const audio = audioRef.current;
    if (useEmbed) {
      audio?.pause();
      const c = ctrlRef.current;
      if (c) {
        c.loadUri(`spotify:track:${current.spotify_id}`);
        c.play();
      }
      setPaused(false);
    } else if (audio && current.preview_url) {
      ctrlRef.current?.pause();
      audio.src = current.preview_url;
      audio.play().catch(() => setPaused(true));
      setPaused(false);
    }
  }, [current, useEmbed]);

  function togglePause() {
    if (useEmbed) {
      ctrlRef.current?.togglePlay();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => null);
      setPaused(false);
    } else {
      audio.pause();
      setPaused(true);
    }
  }

  function skip() {
    let ratio = 0;
    if (useEmbed) {
      const { position, duration } = progressRef.current;
      ratio = duration ? position / duration : 0;
    } else {
      const audio = audioRef.current;
      ratio = audio && audio.duration ? audio.currentTime / audio.duration : 0;
    }
    // early skip = before 30% of the track; otherwise it counts as listened
    next(ratio < 0.3 ? "skipped" : "played");
  }

  const skipRef = useRef(skip);
  skipRef.current = skip;
  const toggleRef = useRef(togglePause);
  toggleRef.current = togglePause;

  // Keyboard: → / N = next, Space = play/pause (ignored while typing). Media keys too.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable=true]")) return;
      if (e.key === "ArrowRight" || e.key === "MediaTrackNext" || e.key.toLowerCase() === "n") {
        e.preventDefault();
        skipRef.current();
      } else if (e.key === " " || e.key === "MediaPlayPause") {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("nexttrack", () => skipRef.current());
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      if ("mediaSession" in navigator) navigator.mediaSession.setActionHandler("nexttrack", null);
    };
  }, [active]);

  if (!active || !current) return null;

  const progressPercent = progress.duration > 0 ? Math.min(100, (progress.position / progress.duration) * 100) : 0;
  const formatTime = (milliseconds: number) => {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
  };

  return (
    <TooltipProvider delayDuration={350}>
    <div className="relative border-t border-border bg-player text-player-foreground">
      {(askSteer || chipsOpen) && (
        <SteerChips
          prompt={askSteer && !chipsOpen}
          active={radio.chips}
          onToggle={toggleChip}
          onClose={() => {
            dismissSteer();
            setChipsOpen(false);
          }}
        />
      )}
      <audio
        ref={audioRef}
        onEnded={() => next("played")}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          const nextProgress = { position: audio.currentTime * 1000, duration: (audio.duration || 0) * 1000 };
          progressRef.current = nextProgress;
          setProgress(nextProgress);
        }}
        className="hidden"
      />
      <div
        ref={embedHost}
        className="absolute h-px w-px overflow-hidden opacity-0"
        aria-hidden="true"
      />

      <div className="grid min-h-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 md:grid-cols-[minmax(180px,1fr)_minmax(300px,1.35fr)_minmax(180px,1fr)] md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-sm bg-surface-2 md:h-16 md:w-16">
            {current.image_url ? (
              <img src={current.image_url} alt={current.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-bold text-muted-foreground">
                {current.name.slice(0, 1)}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-player-foreground">{current.name}</div>
            <div className="truncate text-xs text-player-muted">{current.artists}</div>
          </div>
        </div>

        <div className="order-3 col-span-2 mt-1 flex min-w-0 flex-col items-center md:order-none md:col-span-1 md:mt-0">
          <div className="flex h-10 items-center justify-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button aria-label="Replay this track" onClick={() => next("replay")} variant="ghost" size="icon-sm" className="rounded-full text-player-muted hover:bg-transparent hover:text-player-foreground">
                  <Repeat2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Replay</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button aria-label={paused ? "Play" : "Pause"} onClick={togglePause} variant="ghost" size="icon-lg" className="h-9 w-9 rounded-full bg-player-foreground text-player transition-transform hover:scale-105 hover:bg-player-foreground hover:text-player">
                  {paused ? <Play className="ml-0.5 h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{paused ? "Play" : "Pause"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button aria-label="Next track" onClick={skip} variant="ghost" size="icon-sm" className="rounded-full text-player-muted hover:bg-transparent hover:text-player-foreground">
                  <SkipForward className="h-4 w-4 fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Next</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex w-full max-w-xl items-center gap-2 text-[11px] tabular-nums text-player-muted">
            <span className="w-9 text-right">{formatTime(progress.position)}</span>
            <div className="group relative h-3 flex-1" role="progressbar" aria-label="Track progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)}>
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-player-track">
                <div className="h-full rounded-full bg-player-foreground transition-[width] duration-300 group-hover:bg-primary" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-player-foreground opacity-0 shadow group-hover:opacity-100" style={{ left: `${progressPercent}%` }} />
            </div>
            <span className="w-9">{formatTime(progress.duration)}</span>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-1 md:gap-2">
          {radio.chips.slice(0, 1).map((chip) => (
            <Button key={chip} onClick={() => toggleChip(chip)} variant="ghost" size="xs" className="hidden rounded-full bg-primary/15 px-2 text-[11px] font-semibold text-primary hover:bg-primary/25 hover:text-primary xl:inline-flex">
              {chip} <X className="h-3 w-3" />
            </Button>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label="Steer the radio" onClick={() => setChipsOpen((open) => !open)} variant="ghost" size="icon-sm" className={cn("rounded-full text-player-muted hover:bg-transparent hover:text-player-foreground", (chipsOpen || radio.chips.length > 0) && "text-primary")}>
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Steer the radio</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label="Stop radio" onClick={stopRadio} variant="ghost" size="icon-sm" className="rounded-full text-player-muted hover:bg-transparent hover:text-player-foreground">
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Close player</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
