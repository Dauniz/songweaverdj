import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, CircleHelp, Database, Info, RefreshCw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { getMemoryStatus, refreshMemories, resetMemoryLog } from "@/lib/memory.functions";
import { cn } from "@/lib/utils";
import { PathMaze, CrateConsole } from "@/components/crate/PathMaze";

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


function skillForMemory(kind: string, origin: string, content: string) {
  if (content.startsWith("Note on")) return "Feedbacker";
  if (content.startsWith("Often steers")) return "Steer";
  if (kind === "skipped") return "Skipped";
  if (kind === "favorite") return "Favorite";
  if (origin === "listening") return "Listening";
  if (origin === "button") return "Reaction";
  return "User input";
}

export function MemoryInspector() {
  const qc = useQueryClient();
  const [showLog, setShowLog] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");
  const [resetting, setResetting] = useState(false);
  const reset = useServerFn(resetMemoryLog);
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
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
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
            <span key={k} className="inline-flex items-center gap-1">
              <span className={cn("rounded-full px-2 py-0.5 font-medium", KIND_STYLE[k])}>
                {KIND_LABEL[k] ?? k} · {v}
              </span>
              {k === "mood_trigger" && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label="What is a mood trigger?" className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                        <CircleHelp className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[240px] text-left">
                      A count of the feelings you've tied to songs — via Feedbacker notes or your prompts. Crate recalls them when picking songs, so a feeling you once linked to a song shapes future picks and your personalized suggestions.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
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
            No memory nodes yet. Start a session and get Crate to work.
          </p>
        )}
        {nodes.map((n) => {
          return (
            <div key={n.id} className="rounded-lg border bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="inline-flex rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {skillForMemory(n.kind, n.origin, n.content)}
                </span>
              </div>
              <p className="mt-2 text-sm">{n.content}</p>
              <div className="mt-2 flex justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                {n.blob_id && !n.blob_id.startsWith("job:") ? (() => {
                  const fullId: string = n.blob_id;
                  return (
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="Copy Walrus blob ID"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(fullId);
                              setCopiedId(n.id);
                              setTimeout(() => setCopiedId((c) => (c === n.id ? null : c)), 1500);
                            } catch {
                              // clipboard unavailable — ignore
                            }
                          }}
                          className="min-w-0 cursor-pointer truncate text-left hover:text-foreground"
                        >
                          {copiedId === n.id ? "Copied ✓" : `blob ${n.blob_id.slice(0, 18)}…`}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs break-all font-mono text-[10px]">
                        {n.blob_id}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  );
                })() : (
                  <span className="truncate">
                    {n.blob_id ? "awaiting blob" : "—"}
                  </span>
                )}
                <span>{new Date(n.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          );
        })}
      </div>
      )}
      </div>
      <CrateConsole />
      <div className="flex shrink-0 items-center justify-between border-t px-4 py-2">
        <Link
          to="/crate-info"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Info className="h-3 w-3" /> How Crate uses Walrus
        </Link>
        <button
          type="button"
          onClick={() => {
            setResetText("");
            setResetOpen(true);
          }}
          className="inline-flex items-center gap-1 text-[11px] text-destructive/80 underline-offset-2 hover:text-destructive hover:underline"
        >
          <Trash2 className="h-3 w-3" /> Reset Walrus log
        </button>
      </div>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Walrus log?</AlertDialogTitle>
            <AlertDialogDescription>
              This wipes everything Crate has learned about you — every memory,
              listening lesson and note in the Walrus log. Your imported songs
              stay untouched. It's like resetting your algorithm: a fresh start.
              <span className="mt-3 block font-medium text-foreground">
                Type RESET to confirm.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={resetText}
            onChange={(e) => setResetText(e.target.value)}
            placeholder="RESET"
            autoFocus
            className="font-mono"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={resetText !== "RESET" || resetting}
              onClick={async () => {
                setResetting(true);
                try {
                  await reset({ data: { confirm: "RESET" } });
                  qc.invalidateQueries({ queryKey: ["memories"] });
                  setResetOpen(false);
                } finally {
                  setResetting(false);
                }
              }}
            >
              {resetting ? "Resetting…" : "Reset everything"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
