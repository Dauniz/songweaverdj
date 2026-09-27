import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { History, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { getSpotifyStatus } from "@/lib/spotify.functions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRadio } from "./radio-context";

function ago(iso: string | null | undefined) {
  if (!iso) return "never synced";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `synced ${Math.max(1, mins)} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `synced ${h} h ago`;
  return `synced ${Math.round(h / 24)} days ago`;
}

export function SessionControl() {
  const { sessionLive, startSession, endSession, hasLastSession, resumeLastSession } = useRadio();
  const statusFn = useServerFn(getSpotifyStatus);
  const { data: status } = useQuery({ queryKey: ["spotify-status"], queryFn: () => statusFn() });
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const done = () => {
      setSyncing(false);
      void startSession();
    };
    window.addEventListener("songweaver-sync-done", done);
    return () => window.removeEventListener("songweaver-sync-done", done);
  }, [startSession]);

  if (sessionLive) {
    return (
      <Button
        data-onboarding="session-start"
        variant="outline"
        size="sm"
        className="h-8 rounded-full px-2.5 sm:px-4"
        onClick={endSession}
      >
        <Square className="h-3.5 w-3.5" /> <span className="hidden sm:inline">End session</span>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button data-onboarding="session-start" size="sm" className="h-8 rounded-full px-2.5 sm:px-4" disabled={syncing}>
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{syncing ? "Syncing…" : "Start session"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2 p-3">
        <p className="text-xs text-muted-foreground">Library {ago(status?.lastSyncedAt)}</p>
        <Button
          className="w-full"
          onClick={() => {
            setOpen(false);
            void startSession();
          }}
        >
          <Play className="h-4 w-4" /> Start session
        </Button>
        {hasLastSession && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setOpen(false);
              resumeLastSession();
            }}
          >
            <History className="h-4 w-4" /> Resume last session
          </Button>
        )}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setOpen(false);
            setSyncing(true);
            window.dispatchEvent(new Event("songweaver-sync"));
          }}
        >
          <RefreshCw className="h-4 w-4" /> Sync new songs first
        </Button>
        <p className="text-[11px] leading-snug text-muted-foreground">
          While live, skips and songs you play in Spotify steer Crate. End it to use Spotify as usual.
        </p>
      </PopoverContent>
    </Popover>
  );
}
