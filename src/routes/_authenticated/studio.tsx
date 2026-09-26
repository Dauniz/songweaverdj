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
import { RadioProvider } from "@/components/crate/radio-context";
import { LibraryPanel } from "@/components/crate/LibraryPanel";
import { MemoryInspector } from "@/components/crate/MemoryInspector";
import { cn } from "@/lib/utils";
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
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <img src={logo} alt="Songweaver" width={32} height={32} className="h-8 w-8 rounded-lg" />
        <span className="font-display text-lg font-bold">Songweaver</span>
        <nav className="ml-4 flex gap-1 lg:hidden">
          {(["chat", "memory"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMobileTab(t)}
              className={cn(
                "rounded-full px-3 py-1 text-xs capitalize",
                mobileTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </nav>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={signOut}
                aria-label="Log out"
                className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
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
            "min-w-0 flex-1 bg-glow lg:block",
            mobileTab === "chat" ? "block" : "hidden",
          )}
        >
          <MoodChat />
        </main>
        <aside
          className={cn(
            "w-full border-l bg-sidebar lg:block lg:w-80",
            mobileTab === "memory" ? "block" : "hidden",
          )}
        >
          <MemoryInspector />
        </aside>
      </div>
    </div>
    </RadioProvider>
  );
}
