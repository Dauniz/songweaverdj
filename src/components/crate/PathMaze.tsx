import { Check, CornerDownRight, Route, SkipForward } from "lucide-react";
import { useRadio, type Road } from "@/components/crate/radio-context";
import { cn } from "@/lib/utils";

const ROAD: Record<Road, { name: string; rule: string }> = {
  vibe: { name: "Vibe road", rule: "same feeling & sound" },
  era: { name: "Era road", rule: "same playlist & months" },
  mixed: { name: "New angle", rule: "fresh direction + your memory" },
};

/** Visual "maze solver": the path walked so far, and the two doors ahead. */
export function PathMaze() {
  const { radio, upNext, upSkip } = useRadio();

  return (
    <div className="border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <Route className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-bold uppercase tracking-wider">The maze</h3>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Every song is a junction. Finish it → Crate keeps walking the same road. Skip it → Crate
        turns. Two skips → a new angle. Lessons are written to Walrus.
      </p>

      {!radio.active || !radio.current ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Start a song to enter the maze.
        </p>
      ) : (
        <div className="mt-3 space-y-0">
          {radio.history.slice(-4).map((h, i) => (
            <div key={i} className="flex items-center gap-2 border-l-2 border-muted pl-3 py-1 text-xs">
              {h.outcome === "played" ? (
                <Check className="h-3 w-3 shrink-0 text-primary" />
              ) : (
                <SkipForward className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className={cn("truncate", h.outcome === "skipped" && "text-muted-foreground line-through")}>
                {h.name}
              </span>
            </div>
          ))}

          <div className="rounded-lg border border-primary/40 bg-primary/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-primary">
              You are here · {ROAD[radio.road].name}
            </div>
            <div className="truncate text-sm font-semibold">{radio.current.name}</div>
            <div className="truncate text-xs text-muted-foreground">{radio.current.artists}</div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Door
              label="If you finish"
              road={radio.road}
              title={upNext?.name}
              icon={<Check className="h-3 w-3 text-primary" />}
            />
            <Door
              label="If you skip"
              road={upSkip?.road ?? (radio.consecutiveSkips >= 1 ? "mixed" : radio.road === "vibe" ? "era" : "vibe")}
              title={upSkip?.track.name}
              icon={<SkipForward className="h-3 w-3" />}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Door({ label, road, title, icon }: { label: string; road: Road; title?: string | undefined; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-surface p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 flex items-start gap-1 text-xs">
        <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{title ?? "Finding…"}</span>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {ROAD[road].name}: {ROAD[road].rule}
      </div>
    </div>
  );
}
