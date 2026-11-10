import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "motion/react";
import { ArrowLeft, BookmarkPlus, ListMusic, Loader2, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getLoggedSession, listSessionLog, saveLoggedToSongbook, type SessionLogEntry } from "@/lib/session-log.functions";
import { sessionLength, sessionTitle } from "@/lib/session-log";
import { staggerChildren } from "@/lib/motion";

const PLAY_KEY = "songweaver-songbook-play";

export const Route = createFileRoute("/_authenticated/sessions")({
  head: () => ({
    meta: [
      { title: "Session log — Songweaver" },
      { name: "description", content: "Your recent listening sessions with Crate. Continue one or keep it in your Songbook." },
      { property: "og:title", content: "Session log — Songweaver" },
      { property: "og:description", content: "Your recent listening sessions with Crate. Continue one or keep it in your Songbook." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SessionsPage,
});

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function SessionsPage() {
  const listFn = useServerFn(listSessionLog);
  const getFn = useServerFn(getLoggedSession);
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["session-log"], queryFn: () => listFn() });
  const [saving, setSaving] = useState<SessionLogEntry | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  async function play(e: SessionLogEntry) {
    setOpening(e.id);
    try {
      const { resume_state } = await getFn({ data: { id: e.id } });
      sessionStorage.setItem(PLAY_KEY, JSON.stringify({ tracks: [], resume_state }));
      navigate({ to: "/studio" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open that session");
      setOpening(null);
    }
  }

  const groups: { day: string; items: SessionLogEntry[] }[] = [];
  for (const e of data ?? []) {
    const day = dayLabel(e.started_at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <div className="min-h-dvh bg-background px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Button asChild variant="ghost" size="sm" className="mb-4 text-muted-foreground">
          <Link to="/studio"><ArrowLeft className="h-4 w-4" /> Studio</Link>
        </Button>
        <h1 className="flex items-center gap-2 font-display text-3xl font-extrabold sm:text-4xl">
          <ListMusic className="h-7 w-7 text-primary" /> Session log
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Your recent sessions with Crate. Continue one where it left off, or keep it in your Songbook.
        </p>

        <div className="mt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Opening your log…</p>
          ) : !data?.length ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No sessions yet. Once you play a song all the way through, the session shows up here.
            </p>
          ) : (
            <div className="grid gap-6">
              {groups.map((g) => (
                <section key={g.day}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.day}</h2>
                  <motion.div variants={staggerChildren} initial="hidden" animate="visible" className="grid gap-2">
                    {g.items.map((e) => {
                      const title = sessionTitle(e.seed_prompt, e.first_song);
                      return (
                        <div key={e.id} data-session-row className="kinetic-card grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border bg-surface p-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold sm:text-lg">{title}</div>
                            <div className="text-xs text-muted-foreground sm:text-sm">
                              {timeLabel(e.started_at)} · {sessionLength(e.started_at, e.updated_at)} · {e.played_count} played through
                              {e.skipped_count ? ` · ${e.skipped_count} skipped` : ""}
                            </div>
                          </div>
                          <Button variant="ghost" size="icon-sm" aria-label={`Save ${title} to Songbook`} className="text-muted-foreground" onClick={() => setSaving(e)}>
                            <BookmarkPlus className="h-4 w-4" />
                          </Button>
                          <Button size="icon" aria-label={`Continue ${title}`} className="h-10 w-10 rounded-full transition hover:scale-105" disabled={opening === e.id} onClick={() => play(e)}>
                            {opening === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                          </Button>
                        </div>
                      );
                    })}
                  </motion.div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
      <SaveDialog entry={saving} onClose={() => setSaving(null)} />
    </div>
  );
}

function SaveDialog({ entry, onClose }: { entry: SessionLogEntry | null; onClose: () => void }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveLoggedToSongbook);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (entry && openFor !== entry.id) {
    setOpenFor(entry.id);
    setName(entry.seed_prompt.trim().slice(0, 60));
    setDesc("");
  }

  async function save() {
    if (!entry) return;
    setBusy(true);
    try {
      await saveFn({ data: { id: entry.id, name, description: desc } });
      await qc.invalidateQueries({ queryKey: ["songbook"] });
      toast.success(`Saved "${name.trim()}" to your Songbook`);
      setOpenFor(null);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(o) => { if (!o && !busy) { setOpenFor(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to Songbook</DialogTitle>
          <DialogDescription>Crate keeps the songs you played through and where the session was heading.</DialogDescription>
        </DialogHeader>
        <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Work music" />
        <Textarea value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} placeholder="Perfect for chill background music while working" />
        <DialogFooter>
          <Button disabled={busy || !name.trim()} onClick={save}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
