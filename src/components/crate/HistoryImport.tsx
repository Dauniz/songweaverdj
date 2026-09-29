import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseHistoryFiles, saveHistory } from "@/lib/listening-history";
import { useServerFn } from "@tanstack/react-start";
import { studyHistory } from "@/lib/history-learning.functions";
import { cn } from "@/lib/utils";

/** Optional: drop Spotify Extended Streaming History (the same files stats.fm uses). Parsed locally. */
export function HistoryImport({ libraryIds }: { libraryIds: Set<string> }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const study = useServerFn(studyHistory);

  const { data: imported } = useQuery({
    queryKey: ["listening-history"],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("listening_history")
        .select("spotify_id", { count: "exact", head: true });
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });

  async function handle(files: File[]) {
    if (!files.length) return;
    setResult(null);
    try {
      setStatus("Reading files…");
      const { stats, streams, minYear, maxYear, digest } = await parseHistoryFiles(files);
      if (!stats.length) throw new Error("No song plays found — use the Extended Streaming History files (.zip or .json).");
      await saveHistory(stats, (d) => setStatus(`Saving ${d} / ${stats.length} songs…`));
      const now = Date.now();
      const forgotten = stats.filter(
        (s) => libraryIds.has(s.spotify_id) && s.plays >= 10 && now - Date.parse(s.last_played) > 365 * 86_400_000,
      ).length;
      setStatus("Crate is studying your listening habits…");
      const { saved } = await study({ data: digest }).catch(() => ({ saved: 0 }));
      setResult(
        `${streams.toLocaleString()} plays from ${minYear}–${maxYear}. ${forgotten} forgotten favorites unlocked for Crate.` +
          (saved ? ` Crate learned ${saved} long-term patterns and saved them to Walrus Memory.` : ""),
      );
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["listening-history"] });
      toast.success("Listening history imported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setStatus(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "mt-1 flex items-center gap-1.5 py-2 text-xs transition-colors",
          imported ? "text-primary hover:text-primary/80" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {imported ? (
          <>
            <Check className="h-3.5 w-3.5" /> History imported
          </>
        ) : (
          <>
            <History className="h-3.5 w-3.5" /> Import listening history (optional)
          </>
        )}
      </button>
    );
  }

  return (
    <div className="mt-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void handle([...e.dataTransfer.files]);
        }}
        className={cn(
          "cursor-pointer rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground transition-colors",
          over ? "border-primary bg-primary/10" : "hover:bg-accent",
        )}
      >
        {status ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> {status}
          </span>
        ) : (
          <>
            <p className="font-medium text-foreground">Drop your Spotify history here</p>
            <p className="mt-1">The .zip or .json files you requested for stats.fm. Read on your device — only play counts are saved.</p>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept=".zip,.json"
        className="hidden"
        onChange={(e) => {
          void handle([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {result && (
        <p className="mt-2 rounded-lg border border-primary/30 bg-primary/10 p-2 text-xs text-primary">✓ {result}</p>
      )}
    </div>
  );
}
