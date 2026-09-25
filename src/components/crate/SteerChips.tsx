import { useEffect } from "react";
import { X } from "lucide-react";
import { STEER_CHIPS } from "./radio-context";
import { cn } from "@/lib/utils";

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
    <div className="absolute bottom-full left-1/2 mb-2 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border bg-popover p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold">
          {prompt ? "Want to steer? Totally optional." : "Steer the radio"}
        </span>
        <button aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STEER_CHIPS.map((c) => {
          const on = active.includes(c);
          return (
            <button
              key={c}
              onClick={() => onToggle(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-surface text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}
