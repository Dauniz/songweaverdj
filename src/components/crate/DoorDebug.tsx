import { useEffect, useState } from "react";
import { Bug, ChevronDown, ChevronRight } from "lucide-react";
import { useRadio, type DoorPeek, type DoorSlot } from "@/components/crate/radio-context";

/** Admin-only, read-only view of the songs Crate has prepared behind each door. */
export function DoorDebug() {
  const { peekDoors, sessionLive } = useRadio();
  const [open, setOpen] = useState(true);
  const [snap, setSnap] = useState<DoorPeek | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const tick = () => void peekDoors().then((s) => alive && setSnap(s));
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open, peekDoors]);

  const row = (label: string, desc: string, s: DoorSlot) => (
    <div className="flex gap-2">
      <span className="w-4 shrink-0 font-bold text-primary">{label}</span>
      <span className="w-28 shrink-0 text-muted-foreground">{desc}</span>
      <span className="min-w-0 truncate">
        {s === undefined ? <em className="text-muted-foreground">choosing…</em> : s === null ? <span className="text-destructive">none</span> : `${s.name} — ${s.artists} · ${s.road}`}
      </span>
    </div>
  );

  return (
    <div className="mx-4 mb-2 rounded-lg border border-dashed border-border bg-card/60 px-3 py-2 font-mono text-[11px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 text-muted-foreground">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Bug className="h-3 w-3" /> Door debug (admin)
      </button>
      {open && (
        <div className="mt-1.5 space-y-0.5">
          {!sessionLive || !snap?.current ? (
            <p className="text-muted-foreground">No live session.</p>
          ) : (
            <>
              <div className="flex gap-2"><span className="w-4 shrink-0 font-bold">A</span><span className="w-28 shrink-0 text-muted-foreground">playing</span><span className="truncate">{snap.current}</span></div>
              {row("B", "if you finish", snap.B)}
              {row("v", "skip after B", snap.v)}
              {row("C", "if you skip", snap.C)}
              {row("w", "skip after C", snap.w)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
