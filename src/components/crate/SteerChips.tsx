import { useEffect } from "react";
import { X } from "lucide-react";
import { STEER_CHIPS } from "./steer-chips";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Small, optional steering card. Auto-hides when shown as a prompt; music never stops. */
export function SteerChips({
  prompt,
  active,
  onToggle,
  onClose,
}: {
  prompt: boolean;
  active: string[];
  onToggle: (chip: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!prompt) return;
    const t = setTimeout(onClose, 12_000);
    return () => clearTimeout(t);
  }, [prompt, onClose]);

  return (
    <div className="absolute bottom-full right-3 mb-3 w-[min(430px,calc(100%-1.5rem))] animate-[kinetic-popover-in_240ms_cubic-bezier(0.22,1,0.36,1)] rounded-lg border border-border bg-popover p-4 shadow-2xl sm:right-5 motion-reduce:animate-[kinetic-overlay-in_120ms_ease-out]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold">
          {prompt ? "Want to steer?" : "Steer the radio"}
        </span>
        <Button aria-label="Close" onClick={onClose} variant="ghost" size="icon-xs" className="rounded-full text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {prompt && <p className="mb-3 text-xs text-muted-foreground">A quick nudge, then you can get back to listening.</p>}
      <div className="flex flex-wrap gap-2">
        {STEER_CHIPS.map((c) => {
          const on = active.includes(c);
          return (
            <Button
              key={c}
              onClick={() => onToggle(c)}
              variant="outline"
              size="xs"
              className={cn(
                "rounded-full border px-3 text-xs shadow-none transition",
                on
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:border-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              {c}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
