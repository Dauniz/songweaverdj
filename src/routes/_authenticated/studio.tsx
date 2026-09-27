import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import logo from "@/assets/crate-logo.jpg";

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
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <img src={logo} alt="Songweaver" width={32} height={32} className="h-8 w-8 rounded-lg" />
        <span className="font-display text-lg font-bold">Songweaver</span>
        <nav className="ml-4 flex gap-1 lg:hidden">
          {(["chat", "memory"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onTab(t)}
              className={cn(
                "rounded-full px-3 py-1 text-xs capitalize",
                mobileTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </nav>
        <SessionControl />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onSignOut}
                aria-label="Log out"
                className="ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Log out</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </header>
      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <main
          className={cn(
            "min-w-0 overflow-hidden bg-glow lg:flex-none lg:transition-[width] lg:duration-500 lg:ease-in-out",
            mobileTab === "chat" ? "block" : "hidden lg:block",
            live
              ? "w-full lg:w-2/3"
              : "w-full lg:w-[calc(100%-20rem)]",
          )}
        >
          <MoodChat />
        </main>
        <aside
          className={cn(
            "w-full min-h-0 overflow-hidden border-l bg-sidebar lg:flex-none lg:transition-[width] lg:duration-500 lg:ease-in-out",
            mobileTab === "memory" ? "block" : "hidden lg:block",
            live
              ? "lg:w-1/3"
              : "lg:w-80",
          )}
        >
          <MemoryInspector />
        </aside>
      </div>
    </div>
  );
}
