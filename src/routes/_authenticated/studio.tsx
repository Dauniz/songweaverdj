import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { LogOut } from "lucide-react";
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
import { OnboardingTour } from "@/components/crate/OnboardingTour";
import logo from "@/assets/crate-logo.jpg";
import { Button } from "@/components/ui/button";
import { SpotifyLogPanel } from "@/components/crate/SpotifyLogPanel";

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
      <BugReportButton />
      <SpotifyLogPanel />
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
  const live = sessionLive || radio.active;
  const showMemory = useCallback(() => onTab("memory"), [onTab]);
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="relative flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <img src={logo} alt="Songweaver" width={32} height={32} className="h-8 w-8 shrink-0 rounded-lg" />
          <span className="hidden truncate font-display text-lg font-bold sm:block">Songweaver</span>
        </div>
        <nav className="absolute left-1/2 flex min-w-0 -translate-x-1/2 justify-center gap-1 sm:static sm:col-start-2 sm:translate-x-0 xl:hidden">
          {(["chat", "memory"] as const).map((t) => (
            <Button
              key={t}
              onClick={() => onTab(t)}
              variant="ghost"
              size="xs"
              className={cn(
                "rounded-full px-2.5 text-xs capitalize sm:px-3",
                mobileTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {t}
            </Button>
          ))}
        </nav>
        <div className="col-start-3 flex shrink-0 items-center gap-1">
          <SessionControl />
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
      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <main
          className={cn(
            "min-w-0 overflow-hidden bg-glow xl:flex-none xl:transition-[width] xl:duration-500 xl:ease-in-out",
            mobileTab === "chat" ? "block" : "hidden xl:block",
            live
              ? "w-full xl:w-2/3"
              : "w-full xl:w-[calc(100%-20rem)]",
          )}
        >
          <MoodChat />
        </main>
        <aside
          className={cn(
            "w-full min-h-0 overflow-hidden border-l bg-sidebar xl:flex-none xl:transition-[width] xl:duration-500 xl:ease-in-out",
            mobileTab === "memory" ? "block" : "hidden xl:block",
            live
              ? "xl:w-1/3"
              : "xl:w-80",
          )}
        >
          <MemoryInspector />
        </aside>
      </div>
      <OnboardingTour showMemory={showMemory} />
    </div>
  );
}
