import { useState } from "react";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { CircleHelp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DEEP_CUTS_INFO, LENSES } from "@/lib/lenses";
import { cn } from "@/lib/utils";
import { useRadio } from "./radio-context";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Deep cuts + alternative road toggles, shown in the Walrus Memory tab above the current song. */
export function SideRoads() {
  const { lens, setLens, deepCuts, setDeepCuts } = useRadio();
  const [wormholeBlocked, setWormholeBlocked] = useState(false);
  const { data: hasYearHistory } = useQuery({
    queryKey: ["listening-history", "years"],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listening_history")
        .select("spotify_id")
        .not("plays_by_year", "is", null)
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
  });

  return (
    <TooltipProvider>
      <div data-onboarding="side-roads" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Button
          type="button"
          variant={deepCuts ? "default" : "secondary"}
          size="sm"
          onClick={() => setDeepCuts(!deepCuts)}
          aria-pressed={deepCuts}
          aria-label="Enable Deep cuts"
          className="relative isolate h-8 overflow-hidden rounded-full px-3.5"
        >
          {deepCuts && <motion.span layoutId="active-side-road" className="absolute inset-0 -z-10 rounded-full bg-primary" />}
          <span>Deep cuts</span>
        </Button>
        {LENSES.map((l) => {
          const on = lens === l.id;
          const locked = l.id === "wormhole" && !on && hasYearHistory === false;
          return (
            <Button
              key={l.id}
              type="button"
              variant={on ? "default" : "secondary"}
              size="sm"
              onClick={() => {
                if (l.id === "wormhole" && !on && !hasYearHistory) {
                  setWormholeBlocked(true);
                  return;
                }
                setLens(on ? null : l.id);
              }}
              aria-pressed={on}
              aria-label={`Enable ${l.name}`}
              className={cn("relative isolate h-8 overflow-hidden rounded-full px-3.5", locked && "opacity-60")}
            >
              {on && <motion.span layoutId="active-side-road" className="absolute inset-0 -z-10 rounded-full bg-primary" />}
              <span>{l.name}</span>
            </Button>
          );
        })}
        <AlertDialog open={wormholeBlocked} onOpenChange={setWormholeBlocked}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Wormhole needs your listening history</AlertDialogTitle>
              <AlertDialogDescription>
                Wormhole only plays songs you keep coming back to over the years, so Crate needs your Spotify
                streaming history first. Import your .zip or .json files with "Import listening history" in the
                Spotify panel, then try again. If you imported before this update, import the file once more.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction>Got it</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="About alternative roads"
              className="rounded-full text-muted-foreground"
            >
              <CircleHelp />
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="center"
            className="max-w-[calc(100vw-2rem)] border border-border bg-background text-foreground shadow-lg sm:max-w-[300px]"
          >
            <p>
              Alternative roads replace the default roads (Vibe, Era, New Angle) while they're on.
              Only one can be on at a time — tap it again to go back to the default roads.
            </p>
            {LENSES.map((l) => (
              <p key={l.id} className="mt-3">
                <span className="font-bold">{l.name}:</span> {l.info}
              </p>
            ))}
            <p className="mt-3">
              <span className="font-bold">Deep cuts:</span> {DEEP_CUTS_INFO}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
