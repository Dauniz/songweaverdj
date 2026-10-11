import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MOTION_EASE } from "@/lib/motion";
import { Brain, LogOut } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { MoodChat } from "@/components/crate/MoodChat";
import { RadioProvider, useRadio } from "@/components/crate/radio-context";
import { LibraryPanel } from "@/components/crate/LibraryPanel";
import { MemoryInspector } from "@/components/crate/MemoryInspector";
import { SessionControl } from "@/components/crate/SessionControl";
import { cn } from "@/lib/utils";
import { BugReportButton } from "@/components/BugReportButton";
import { IosBackgroundNotice } from "@/components/crate/IosBackgroundNotice";
import { OnboardingTour } from "@/components/crate/OnboardingTour";
import logo from "@/assets/crate-logo.jpg";
import { Button } from "@/components/ui/button";
// import { SpotifyLogPanel } from "@/components/crate/SpotifyLogPanel";

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({
    meta: [
      { title: "Studio — Songweaver" },
      {
        name: "description",
        content: "Chat your vibe and rediscover tracks from your past playlists.",
      },
      { property: "og:title", content: "Studio — Songweaver" },
      {
        property: "og:description",
        content: "Chat your vibe and rediscover tracks from your past playlists.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

function Studio() {
  const navigate = useNavigate();
  const [mobileTab, setMobileTab] = useState<"chat" | "memory">("chat");
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <RadioProvider>
      <StudioLayout mobileTab={mobileTab} onTab={setMobileTab} onSignOut={signOut} />
      <IosBackgroundNotice />
      {/* Spotify live log hidden for now — re-enable by rendering <SpotifyLogPanel /> */}
    </RadioProvider>
  );
}

/** Reads the live radio state so the layout can rebalance while a session runs. */
function StudioLayout({
  mobileTab,
  onTab,
  onSignOut,
}: {
  mobileTab: "chat" | "memory";
  onTab: (t: "chat" | "memory") => void;
  onSignOut: () => void;
}) {
  const { sessionLive, radio } = useRadio();
  const reduced = useReducedMotion();
  const live = sessionLive || radio.active;
  const showMemory = useCallback(() => onTab("memory"), [onTab]);
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="relative flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <img src={logo} alt="Songweaver" width={32} height={32} className="h-8 w-8 shrink-0 rounded-lg" />
          <span className="hidden truncate font-display text-lg font-bold sm:block">Songweaver</span>
          <BugReportButton />
        </div>
        <nav className="absolute left-1/2 flex min-w-0 -translate-x-1/2 justify-center gap-1 xl:hidden">
          {(["chat", "memory"] as const).map((t) => (
            <Button
              key={t}
              onClick={() => onTab(t)}
              variant="ghost"
              size="xs"
              className={cn(
                "h-9 rounded-full px-3 text-xs capitalize sm:h-7",
                "relative isolate overflow-hidden",
                mobileTab === t ? "text-primary-foreground hover:bg-transparent" : "text-muted-foreground",
              )}
            >
              {mobileTab === t && (
                <motion.span
                  layoutId="studio-mobile-tab"
                  className="absolute inset-0 -z-10 rounded-full bg-primary"
                  transition={{ duration: reduced ? 0.12 : 0.24, ease: MOTION_EASE }}
                />
              )}
              <span>{t === "memory" ? "maze" : t}</span>
            </Button>
          ))}
        </nav>
        <div className="col-start-3 flex shrink-0 items-center gap-1">
          <SessionControl />
          <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="What Crate knows about you">
            <Link to="/crate-knows"><Brain className="h-4 w-4" /></Link>
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={onSignOut} aria-label="Log out" variant="ghost" size="icon-sm" className="text-muted-foreground">
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Log out</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <LibraryPanel />
        <motion.main
          layout={!reduced}
          className={cn(
            "absolute inset-0 min-w-0 overflow-hidden bg-glow pt-12 transition-[opacity,transform] duration-300 ease-out xl:static xl:block xl:pt-0 xl:flex-none",
            mobileTab === "chat" ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-3 opacity-0 xl:pointer-events-auto xl:translate-x-0 xl:opacity-100",
            live
              ? "w-full xl:w-2/3"
              : "w-full xl:w-[calc(100%-20rem)]",
          )}
          transition={{ duration: reduced ? 0.12 : 0.36, ease: MOTION_EASE }}
        >
          <h1 className="sr-only">Songweaver Studio</h1>
          <MoodChat onSearchSelection={() => onTab("memory")} />
        </motion.main>
        <motion.aside
          layout={!reduced}
          className={cn(
            "absolute inset-0 min-h-0 w-full overflow-hidden border-l bg-sidebar pt-12 transition-[opacity,transform] duration-300 ease-out xl:static xl:block xl:pt-0 xl:flex-none",
            mobileTab === "memory" ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3 opacity-0 xl:pointer-events-auto xl:translate-x-0 xl:opacity-100",
            live
              ? "xl:w-1/3"
              : "xl:w-80",
          )}
          transition={{ duration: reduced ? 0.12 : 0.36, ease: MOTION_EASE }}
        >
          <MemoryInspector />
        </motion.aside>
      </div>
      <OnboardingTour showMemory={showMemory} showChat={() => onTab("chat")} />
    </div>
  );
}
