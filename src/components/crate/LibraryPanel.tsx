import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Disc3, Loader2 } from "lucide-react";
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
import { useRadio } from "@/components/crate/radio-context";
import { cn } from "@/lib/utils";
import { openSpotifyAuth, usePreparedSpotifyUrl } from "@/lib/spotify-open";
import { HistoryImport } from "@/components/crate/HistoryImport";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MOTION_EASE } from "@/lib/motion";

export function LibraryPanel() {
  const reduced = useReducedMotion();
  const qc = useQueryClient();
  const statusFn = useServerFn(getSpotifyStatus);
  const authUrlFn = useServerFn(getSpotifyAuthUrl);
  const syncFn = useServerFn(syncSpotifyLibrary);
  const disconnectFn = useServerFn(disconnectSpotify);
  const progressFn = useServerFn(getSyncProgress);
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("spotify-card-collapsed");
    setCollapsed(saved ? saved === "1" : window.innerWidth < 640);
  }, []);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<{
    imported: number;
    playlists: number;
    liked: number;
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
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("library_tracks")
          .select("id, spotify_id, name, artists, source_name, source_period, source_type, is_demo, image_url")
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

  const preparedAuth = usePreparedSpotifyUrl(() =>
    authUrlFn({ data: { origin: window.location.origin } }),
  );

  async function connect() {
    const ready = preparedAuth.get();
    if (ready) {
      openSpotifyAuth(ready, "spotify-auth");
      return;
    }
    setBusy("connect");
    try {
      const { url } = await authUrlFn({ data: { origin: window.location.origin } });
      window.location.assign(url);
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
      if (r.partial)
        toast.warning(`Spotify slowed us down — ${r.imported} tracks saved. Sync again in a few minutes for the rest.`);
      else toast.success(`Sync complete — ${r.imported} tracks loaded`);
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["spotify-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
      setSyncing(false);
      window.dispatchEvent(new Event("songweaver-sync-done"));
    }
  }

  useEffect(() => {
    const onSync = () => {
      setCollapsed(false);
      void sync();
    };
    const onOnboarding = () => setCollapsed(false);
    window.addEventListener("songweaver-sync", onSync);
    window.addEventListener("songweaver-onboarding-open-spotify", onOnboarding);
    return () => {
      window.removeEventListener("songweaver-sync", onSync);
      window.removeEventListener("songweaver-onboarding-open-spotify", onOnboarding);
    };
  });

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
  const { spotifyLost } = useRadio();
  const orbClass = spotifyLost
    ? "bg-destructive shadow-[0_0_6px_var(--destructive)]"
    : status?.connected
      ? "bg-primary shadow-[0_0_6px_var(--primary)]"
      : "bg-muted-foreground/40";
  const orbLabel = spotifyLost
    ? "Spotify connection lost"
    : status?.connected
      ? "Spotify connected"
      : "Spotify not connected";

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem("spotify-card-collapsed", c ? "0" : "1");
      return !c;
    });
  }

  if (collapsed) {
    return (
      <motion.div
        layoutId="spotify-panel"
        initial={{ opacity: 0, scale: reduced ? 1 : 0.92, x: reduced ? 0 : -6 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        transition={{ duration: reduced ? 0.12 : 0.28, ease: MOTION_EASE }}
        className="fixed left-3 top-16 z-40 sm:left-4"
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Expand Spotify panel"
                className="kinetic-control flex h-9 items-center gap-2 rounded-full border bg-card/95 px-3 shadow-lg backdrop-blur hover:bg-accent"
              >
                <span className={cn("inline-block h-2 w-2 rounded-full", orbClass)} />
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{orbLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </motion.div>
    );
  }

  return (
    <motion.div
      layoutId="spotify-panel"
      initial={{ opacity: 0, scale: reduced ? 1 : 0.96, x: reduced ? 0 : -8, clipPath: reduced ? "none" : "inset(0 0 20% 0)" }}
      animate={{ opacity: 1, scale: 1, x: 0, clipPath: "inset(0)" }}
      transition={{ duration: reduced ? 0.12 : 0.32, ease: MOTION_EASE }}
      className="scrollbar-thin fixed left-3 top-16 z-40 max-h-[calc(100dvh-5rem)] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur sm:left-4 sm:w-72"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Disc3 className="h-4 w-4 text-primary" /> Spotify
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={orbLabel}
                className={cn("inline-block h-2 w-2 shrink-0 rounded-full", orbClass)}
              />
            </TooltipTrigger>
            <TooltipContent side="right">{orbLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {tracks.length} tracks
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Minimize Spotify panel"
          className="kinetic-control -m-1.5 rounded-sm p-2 text-muted-foreground hover:text-foreground"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
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
          <AnimatePresence mode="wait">
          {(syncing || summary) && (
            <motion.div
              key={syncing ? "syncing" : "summary"}
              initial={{ opacity: 0, y: reduced ? 0 : 5, clipPath: reduced ? "none" : "inset(0 0 30% 0)" }}
              animate={{ opacity: 1, y: 0, clipPath: "inset(0)" }}
              exit={{ opacity: 0, y: reduced ? 0 : -3 }}
              transition={{ duration: reduced ? 0.12 : 0.24, ease: MOTION_EASE }}
              className="mt-3 space-y-2"
            >
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
                    {summary.liked} liked songs
                  </p>
                </div>
              )}
            </motion.div>
          )}
          </AnimatePresence>
          <div className="mt-2 flex gap-2">
            <Button data-onboarding="spotify-sync" size="sm" onClick={sync} disabled={busy !== null}>
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
        <Button data-onboarding="spotify-sync" size="sm" className="mt-2" onClick={connect} disabled={busy !== null}>
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
      <HistoryImport libraryIds={new Set(tracks.map((t) => t.spotify_id))} />
    </motion.div>
  );
}
