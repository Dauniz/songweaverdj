import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Send, SkipForward, X } from "lucide-react";
import { useRadio } from "./radio-context";
import { cn } from "@/lib/utils";

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
  const { radio, stopRadio, next, steer, refilling } = useRadio();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [paused, setPaused] = useState(false);
  const [steerText, setSteerText] = useState("");
  const [steering, setSteering] = useState(false);

  const current = radio.queue[radio.currentIndex];
  const upNext = radio.queue.slice(radio.currentIndex + 1, radio.currentIndex + 4);

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
          setPaused(Boolean(isPaused));
          if (duration > 0 && position >= duration - 800 && !endedRef.current) {
            endedRef.current = true;
            nextRef.current("ended");
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
  }, [current?.id, current?.preview_url, current?.spotify_id, useEmbed, radio.currentIndex]);

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
    next(ratio < 0.3 ? "skipped" : "ended");
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

  function _unusedTogglePause() {
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
    const audio = audioRef.current;
    // early skip = before 30% of the preview; otherwise it counts as listened
    const early = audio && audio.duration ? audio.currentTime / audio.duration < 0.3 : true;
    next(early ? "skipped" : "ended");
  }

  async function sendSteer() {
    const t = steerText.trim();
    if (!t || steering) return;
    setSteering(true);
    setSteerText("");
    await steer(t).catch(() => null);
    setSteering(false);
  }

  return (
    <div className="border-t bg-sidebar/95 backdrop-blur">
      <audio
        ref={audioRef}
        onEnded={() => next("ended")}
        className="hidden"
      />
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-primary/60 to-magenta/60">
          {current.image_url ? (
            <img src={current.image_url} alt={current.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-display text-lg font-bold text-primary-foreground">
              {current.name.slice(0, 1)}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{current.name}</div>
          <div className="truncate text-xs text-muted-foreground">{current.artists}</div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Replay this track"
            onClick={() => next("replay")}
            className="rounded-full p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            aria-label={paused ? "Play" : "Pause"}
            onClick={togglePause}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:scale-105"
          >
            {paused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
          </button>
          <button
            aria-label="Next track"
            onClick={skip}
            className="rounded-full p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        {radio.modeLabel && (
          <span className="hidden shrink-0 rounded-full bg-magenta/15 px-2.5 py-1 text-[11px] font-semibold text-magenta sm:inline">
            {radio.modeLabel}
          </span>
        )}
        {refilling && (
          <span className="hidden shrink-0 animate-pulse text-[11px] text-muted-foreground md:inline">
            Queuing more…
          </span>
        )}

        <div className="ml-auto hidden min-w-0 flex-1 items-center gap-2 md:flex">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {upNext.map((t) => (
              <div
                key={t.id}
                className="flex shrink-0 items-center gap-1.5 rounded-full border bg-surface px-2 py-1 text-[11px] text-muted-foreground"
              >
                {t.image_url && (
                  <img src={t.image_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                )}
                <span className="max-w-32 truncate">{t.name}</span>
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-full border bg-surface px-3 py-1">
            <input
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendSteer()}
              placeholder="Steer: “sadder”, “newer”…"
              className="w-36 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            <button
              aria-label="Steer the radio"
              onClick={sendSteer}
              disabled={!steerText.trim() || steering}
              className="text-muted-foreground transition hover:text-primary disabled:opacity-30"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <button
          aria-label="Stop radio"
          onClick={stopRadio}
          className={cn(
            "shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground",
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
