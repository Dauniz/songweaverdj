import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Database, Info, RefreshCw, Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { getMemoryStatus, refreshMemories } from "@/lib/memory.functions";
import { cn } from "@/lib/utils";
import { PathMaze } from "@/components/crate/PathMaze";

const KIND_LABEL: Record<string, string> = {
  taste: "Taste",
  genre: "Genre",
  mood_trigger: "Mood trigger",
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

const SKILLS: { name: string; how: string }[] = [
  {
    name: "User input",
    how: "What you type or say in the chat becomes a memory — moods, settings, artists you name.",
  },
  {
    name: "Listening",
    how: "Finishes, replays and skips are counted. Skip an artist twice and they fade for the session; replay a song across sessions and it becomes a quiet favorite.",
  },
  {
    name: "Steer",
    how: "Chips like Svenskt, Nostalgi or Instrumental — or a song you spontaneously play — redirect the maze. Chips picked in 3+ sessions become taste memories.",
  },
  {
    name: "Feedbacker",
    how: "A free note on the song playing right now (\"nostalgi, högstadiet\") — the sharpest signal Crate gets.",
  },
  {
    name: "Deep cuts",
    how: "When enabled, Crate skips everything you've heard lately and digs into playlists a year old or more.",
  },
  {
    name: "The Maze",
    how: "Finish a song → Crate keeps walking the same road. Skip → it turns. Two skips → a new angle. Every lesson is written to Walrus.",
  },
];

export function MemoryInspector() {
  const qc = useQueryClient();
  const [showLog, setShowLog] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Re-check Walrus memories"
                onClick={async () => {
                  await refresh().catch(() => null);
                  qc.invalidateQueries({ queryKey: ["memories"] });
                }}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              Re-checks your Walrus memories — nothing is reset
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <PathMaze />
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
          {Object.entries(counts).filter(([k]) => KIND_LABEL[k]).map(([k, v]) => (
            <span key={k} className={cn("rounded-full px-2 py-0.5 font-medium", KIND_STYLE[k])}>
              {KIND_LABEL[k] ?? k} · {v}
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={showLog}
          onClick={() => setShowLog((v) => !v)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {showLog ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {showLog ? "Hide Walrus log" : "Show Walrus log"}
        </button>
      </div>
      {showLog && (
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
                <span className="text-[11px] font-medium text-muted-foreground">
                  {new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.cls)} /> {s.label}
                </span>
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {n.origin === "listening"
                  ? "Based on how you listened (skips, replays, finishes)"
                  : n.origin === "button"
                    ? "Based on your reaction to a song"
                    : "Based on user input"}
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
      )}
    </div>
  );
}
