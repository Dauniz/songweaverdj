import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookmarkPlus, History, Loader2, Play, Square } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveSongbook } from "@/lib/songbook.functions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getSpotifyStatus, syncRecentSpotify } from "@/lib/spotify.functions";
import { useRadio } from "./radio-context";

const STALE_MS = 6 * 60 * 60_000;

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

function SaveToSongbook() {
  const { getSongbookSnapshot } = useRadio();
  const saveFn = useServerFn(saveSongbook);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const snap = getSongbookSnapshot();
    if (!snap) return toast.error("Start playing first, then save");
    setBusy(true);
    try {
      await saveFn({ data: { name, description: desc, tracks: snap.tracks, resume_state: snap.resume_state } });
      qc.invalidateQueries({ queryKey: ["songbook"] });
      toast.success(`Saved "${name.trim()}" to your Songbook`);
      setOpen(false); setName(""); setDesc("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 rounded-full px-1.5 text-muted-foreground lg:px-2.5" onClick={() => setOpen(true)} aria-label="Save to Songbook">
        <BookmarkPlus className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Save to Songbook</span>
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save to Songbook</DialogTitle>
            <DialogDescription>Crate remembers where this session is heading and the songs you played through.</DialogDescription>
          </DialogHeader>
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Work music" />
          <Textarea value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} placeholder="Perfect for chill background music while working" />
          <DialogFooter>
            <Button onClick={save} disabled={busy || !name.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Live: End session. Otherwise: Start (new) session, plus Resume when a saved session exists. */
export function SessionControl() {
  const { sessionLive, endSession, startSession, hasLastSession, resumeLastSession } = useRadio();
  const qc = useQueryClient();
  const statusFn = useServerFn(getSpotifyStatus);
  const syncFn = useServerFn(syncRecentSpotify);
  const { data: status } = useQuery({ queryKey: ["spotify-status"], queryFn: () => statusFn() });
  const [pending, setPending] = useState<null | (() => void)>(null);
  const [syncing, setSyncing] = useState(false);

  function gate(action: () => void) {
    const last = status?.lastSyncedAt;
    if (status?.connected && last && Date.now() - Date.parse(last) > STALE_MS) setPending(() => action);
    else action();
  }

  async function syncAndGo() {
    const go = pending;
    setSyncing(true);
    try {
      const r = await syncFn();
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["listening-history"] });
      qc.invalidateQueries({ queryKey: ["spotify-status"] });
      toast.success(`Synced: ${r.newSongs} new songs, ${r.recentPlays} recent plays`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed — starting anyway");
    } finally {
      setSyncing(false);
      setPending(null);
      go?.();
    }
  }

  if (sessionLive) {
    return (
      <div className="flex items-center gap-1">
        <SaveToSongbook />
        <Button variant="outline" size="sm" className="h-8 rounded-full px-2.5 lg:px-4" onClick={endSession}>
          <Square className="h-3.5 w-3.5" /> <span className="hidden lg:inline">End session</span>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {hasLastSession && (
        <Button variant="ghost" size="sm" className="h-8 rounded-full px-1.5 text-muted-foreground lg:px-2.5" onClick={() => gate(resumeLastSession)}>
          <History className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Resume last session</span>
        </Button>
      )}
      <Button size="sm" className="h-8 rounded-full px-2 lg:px-3" onClick={() => gate(() => void startSession())}>
        <Play className="h-3.5 w-3.5" /> <span className="hidden lg:inline">{hasLastSession ? "Start new session" : "Start session"}</span>
      </Button>
      <Dialog open={!!pending} onOpenChange={(o) => !o && !syncing && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync recent data first?</DialogTitle>
            <DialogDescription>
              {status?.lastSyncedAt ? `Last synced ${ago(status.lastSyncedAt)}. ` : ""}
              Crate fetches only newly saved songs, playlist additions and your recent plays. Spotify shares at most your last 50 plays.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              disabled={syncing}
              onClick={() => {
                const go = pending;
                setPending(null);
                go?.();
              }}
            >
              Skip
            </Button>
            <Button onClick={syncAndGo} disabled={syncing}>
              {syncing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Syncing your recent listening…
                </>
              ) : (
                "Sync & start"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
