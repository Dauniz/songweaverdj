import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Database, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMemoryStatus, refreshMemories } from "@/lib/memory.functions";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  taste: "Taste",
  genre: "Genre",
  mood_trigger: "Mood trigger",
  skipped: "Skipped",
  session: "Session",
  favorite: "Favorite",
};

const KIND_STYLE: Record<string, string> = {
  taste: "bg-primary/15 text-primary",
  genre: "bg-chart-3/15 text-chart-3",
  mood_trigger: "bg-magenta/15 text-magenta",
  skipped: "bg-destructive/15 text-destructive",
  session: "bg-chart-4/15 text-chart-4",
  favorite: "bg-chart-5/15 text-chart-5",
};

const STATUS: Record<string, { label: string; cls: string }> = {
  stored: { label: "On Walrus", cls: "bg-primary" },
  pending: { label: "Writing…", cls: "bg-chart-4 animate-pulse" },
  local: { label: "Local only", cls: "bg-muted-foreground" },
  failed: { label: "Failed", cls: "bg-destructive" },
};

export function MemoryInspector() {
  const qc = useQueryClient();
  const refresh = useServerFn(refreshMemories);
  const status = useServerFn(getMemoryStatus);
  const { data: cfg } = useQuery({ queryKey: ["memwal-status"], queryFn: () => status() });
  const { data: nodes = [] } = useQuery({
    queryKey: ["memories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memory_nodes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const hasPending = nodes.some((n) => n.status === "pending");
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(async () => {
      const r = await refresh().catch(() => null);
      if (r?.updated) qc.invalidateQueries({ queryKey: ["memories"] });
    }, 6000);
    return () => clearInterval(t);
  }, [hasPending, refresh, qc]);

  const counts = nodes.reduce<Record<string, number>>(
    (a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a),
    {},
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Walrus Memory</h2>
        </div>
        <button
          aria-label="Refresh memories"
          onClick={async () => {
            await refresh().catch(() => null);
            qc.invalidateQueries({ queryKey: ["memories"] });
          }}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="px-4 py-3 text-xs">
        {cfg?.configured ? (
          <span className="inline-flex items-center gap-1.5 text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Connected to Walrus relayer
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" /> Walrus keys not added
            — memories saved locally
          </span>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(counts).map(([k, v]) => (
            <span key={k} className={cn("rounded-full px-2 py-0.5 font-medium", KIND_STYLE[k])}>
              {KIND_LABEL[k] ?? k} · {v}
            </span>
          ))}
        </div>
      </div>
      <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {nodes.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No memory nodes yet. Chat about your vibe, or tap “Still love it” / “Skip” on a card.
          </p>
        )}
        {nodes.map((n) => {
          const s = STATUS[n.status] ?? STATUS["local"]!;
          return (
            <div key={n.id} className="rounded-lg border bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    KIND_STYLE[n.kind],
                  )}
                >
                  {KIND_LABEL[n.kind] ?? n.kind}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.cls)} /> {s.label}
                </span>
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {n.origin === "listening"
                  ? "Learned from listening"
                  : n.origin === "button"
                    ? "You tapped a button"
                    : "You said this"}
              </div>
              <p className="mt-2 text-sm">{n.content}</p>
              <div className="mt-2 flex justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                <span className="truncate">
                  {n.blob_id && !n.blob_id.startsWith("job:")
                    ? `blob ${n.blob_id.slice(0, 18)}…`
                    : n.blob_id
                      ? "awaiting blob"
                      : "—"}
                </span>
                <span>{new Date(n.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
