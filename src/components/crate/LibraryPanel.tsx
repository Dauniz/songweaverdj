import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Disc3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  disconnectSpotify,
  getSpotifyAuthUrl,
  getSpotifyStatus,
  getSyncProgress,
  syncSpotifyLibrary,
} from "@/lib/spotify.functions";
import { buildDemoRows } from "@/lib/demo-library";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export function LibraryPanel() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getSpotifyStatus);
  const authUrlFn = useServerFn(getSpotifyAuthUrl);
  const syncFn = useServerFn(syncSpotifyLibrary);
  const disconnectFn = useServerFn(disconnectSpotify);
  const progressFn = useServerFn(getSyncProgress);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<{
    imported: number;
    playlists: number;
    liked: number;
    recent: number;
  } | null>(null);

  const { data: progress } = useQuery({
    queryKey: ["sync-progress"],
    queryFn: () => progressFn(),
    enabled: syncing,
    refetchInterval: syncing ? 700 : false,
  });
  const pct =
    progress && progress.total
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;

  const { data: status } = useQuery({ queryKey: ["spotify-status"], queryFn: () => statusFn() });
  const { data: tracks = [] } = useQuery({
    queryKey: ["library"],
    queryFn: async () => {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("library_tracks")
          .select("id, name, artists, source_name, source_period, source_type, is_demo, image_url")
          .order("source_period", { ascending: false, nullsFirst: false })
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) break;
      }
      return all;
    },
  });

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data?.type === "spotify-connected") {
        qc.invalidateQueries({ queryKey: ["spotify-status"] });
        if (e.data.ok) toast.success("Spotify connected — hit Sync to import your playlists.");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [qc]);

  async function connect() {
    setBusy("connect");
    try {
      const { url } = await authUrlFn({ data: { origin: window.location.origin } });
      window.open(url, "spotify-auth", "width=520,height=720");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start Spotify sign-in");
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    setSyncing(true);
    setSummary(null);
    try {
      const r = await syncFn();
      setSummary(r);
      toast.success(`Sync complete — ${r.imported} tracks loaded`);
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["spotify-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
      setSyncing(false);
    }
  }

  async function loadDemo() {
    setBusy("demo");
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("library_tracks")
        .upsert(buildDemoRows(data.user.id), { onConflict: "user_id,spotify_id,source_name" });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["library"] });
      toast.success("Demo library loaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load demo");
    } finally {
      setBusy(null);
    }
  }

  async function clearDemo() {
    await supabase.from("library_tracks").delete().eq("is_demo", true);
    qc.invalidateQueries({ queryKey: ["library"] });
  }

  const hasDemo = tracks.some((t) => t.is_demo);

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Disc3 className="h-4 w-4 text-primary" /> Spotify
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={status?.connected ? "Spotify connected" : "Spotify not connected"}
                className={cn(
                  "inline-block h-2 w-2 shrink-0 rounded-full",
                  status?.connected
                    ? "bg-primary shadow-[0_0_6px_var(--primary)]"
                    : "bg-muted-foreground/40",
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="left">
              {status?.connected ? "Spotify connected" : "Spotify not connected"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {tracks.length} tracks
        </span>
      </div>
      {!status ? (
        <p className="mt-1 text-xs text-muted-foreground">Checking…</p>
      ) : !status.configured ? (
        <p className="mt-1 text-xs text-muted-foreground">Spotify app keys not added yet.</p>
      ) : status.connected ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {status.displayName} ·{" "}
            {status.lastSyncedAt
              ? `synced ${new Date(status.lastSyncedAt).toLocaleString()}`
              : "not synced yet"}
          </p>
          {(syncing || summary) && (
            <div className="mt-3 space-y-2">
              {syncing && (
                <>
                  <Progress value={pct ?? undefined} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">{progress?.stage ?? "Starting…"}</p>
                </>
              )}
              {!syncing && summary && (
                <div className="rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-xs">
                  <p className="font-semibold text-primary">✓ Library loaded</p>
                  <p className="mt-1 text-muted-foreground">
                    {summary.imported} tracks · from {summary.playlists} playlists ·{" "}
                    {summary.liked} liked songs · {summary.recent} recently played
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={sync} disabled={busy !== null}>
              {busy === "sync" && <Loader2 className="h-3 w-3 animate-spin" />} Sync library
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await disconnectFn();
                qc.invalidateQueries({ queryKey: ["spotify-status"] });
              }}
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" className="mt-2" onClick={connect} disabled={busy !== null}>
          Connect Spotify
        </Button>
      )}
      <div className="mt-2">
        {hasDemo ? (
          <Button size="xs" variant="outline" onClick={clearDemo}>
            Remove demo tracks
          </Button>
        ) : (
          <Button size="xs" variant="outline" onClick={loadDemo} disabled={busy !== null}>
            {busy === "demo" && <Loader2 className="h-3 w-3 animate-spin" />} Load demo library
          </Button>
        )}
      </div>
    </div>
  );
}
