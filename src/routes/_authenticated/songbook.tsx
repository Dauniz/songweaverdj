import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "motion/react";
import { ArrowLeft, BookHeart, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteSongbook, listSongbook, updateSongbook, type SongbookEntry } from "@/lib/songbook.functions";
import { staggerChildren } from "@/lib/motion";

export const SONGBOOK_PLAY_KEY = "songweaver-songbook-play";

export const Route = createFileRoute("/_authenticated/songbook")({
  head: () => ({
    meta: [
      { title: "Songbook — Songweaver" },
      { name: "description", content: "Your saved sessions. Press play and Crate keeps the vibe going." },
      { property: "og:title", content: "Songbook — Songweaver" },
      { property: "og:description", content: "Your saved sessions. Press play and Crate keeps the vibe going." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SongbookPage,
});

function SongbookPage() {
  const listFn = useServerFn(listSongbook);
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["songbook"], queryFn: () => listFn() });
  const [editing, setEditing] = useState<SongbookEntry | null>(null);

  function play(e: SongbookEntry) {
    sessionStorage.setItem(SONGBOOK_PLAY_KEY, JSON.stringify({ tracks: e.tracks, resume_state: e.resume_state }));
    navigate({ to: "/studio" });
  }

  return (
    <div className="min-h-dvh bg-background px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <Button asChild variant="ghost" size="sm" className="mb-4 text-muted-foreground">
          <Link to="/studio"><ArrowLeft className="h-4 w-4" /> Studio</Link>
        </Button>
        <h1 className="flex items-center gap-2 font-display text-3xl font-extrabold sm:text-4xl">
          <BookHeart className="h-7 w-7 text-primary" /> Songbook
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Save sessions you love. Press play and Crate picks up the vibe and keeps it going. No browsing needed.
        </p>

        <div className="mt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Opening your Songbook…</p>
          ) : !data?.length ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nothing saved yet. During a session, press the Songbook save button next to End session.
            </p>
          ) : (
            <motion.div variants={staggerChildren} initial="hidden" animate="visible" className="grid gap-2">
              {data.map((e) => (
                <div key={e.id} className="kinetic-card group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border bg-surface p-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold sm:text-lg">{e.name}</div>
                    {e.description && <div className="line-clamp-2 text-xs text-muted-foreground sm:text-sm">{e.description}</div>}
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${e.name}`} className="text-muted-foreground" onClick={() => setEditing(e)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" aria-label={`Play ${e.name}`} className="h-10 w-10 rounded-full transition hover:scale-105" onClick={() => play(e)}>
                    <Play className="h-4 w-4 fill-current" />
                  </Button>
                </div>
              ))}
            </motion.div>
          )}
        </div>
      </div>
      <EditDialog entry={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function EditDialog({ entry, onClose }: { entry: SongbookEntry | null; onClose: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateSongbook);
  const deleteFn = useServerFn(deleteSongbook);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (entry && openFor !== entry.id) { setOpenFor(entry.id); setName(entry.name); setDesc(entry.description); }

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try { await fn(); await qc.invalidateQueries({ queryKey: ["songbook"] }); toast.success(msg); setOpenFor(null); onClose(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(o) => { if (!o) { setOpenFor(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Songbook entry</DialogTitle></DialogHeader>
        <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <Textarea value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} placeholder="Description" />
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => entry && run(() => deleteFn({ data: { id: entry.id } }), "Removed from your Songbook")}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button disabled={busy || !name.trim()} onClick={() => entry && run(() => updateFn({ data: { id: entry.id, name, description: desc } }), "Saved")}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
