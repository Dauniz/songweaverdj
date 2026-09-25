import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { UIMessage } from "ai";
import { LogOut } from "lucide-react";
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
      { title: "Studio — Crate" },
      {
        name: "description",
        content: "Chat your vibe and rediscover tracks from your past playlists.",
      },
      { property: "og:title", content: "Studio — Crate" },
      {
        property: "og:description",
        content: "Chat your vibe and rediscover tracks from your past playlists.",
      },
    ],
  }),
  component: Studio,
});

function Studio() {
  const navigate = useNavigate();
  const [mobileTab, setMobileTab] = useState<"library" | "chat" | "memory">("chat");
  const { data: history, isLoading } = useQuery({
    queryKey: ["chat-history"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("message")
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => r.message as unknown as UIMessage);
    },
  });

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <RadioProvider>
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <img src={logo} alt="Crate" width={32} height={32} className="h-8 w-8 rounded-lg" />
        <span className="font-display text-lg font-bold">Crate</span>
        <nav className="ml-4 flex gap-1 lg:hidden">
          {(["library", "chat", "memory"] as const).map((t) => (
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
        <button
          onClick={signOut}
          aria-label="Sign out"
          className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "w-full border-r bg-sidebar lg:block lg:w-80",
            mobileTab === "library" ? "block" : "hidden",
          )}
        >
          <LibraryPanel />
        </aside>
        <main
          className={cn(
            "min-w-0 flex-1 bg-glow lg:block",
            mobileTab === "chat" ? "block" : "hidden",
          )}
        >
          {isLoading ? (
            <div className="chat-loading mx-auto flex h-full w-full max-w-4xl flex-col gap-4 px-7 pt-8" aria-label="Loading your session">
              <div className="ml-auto h-10 w-2/5 rounded-lg bg-primary/15" />
              <div className="h-4 w-3/5 rounded bg-muted" />
              <div className="grid grid-cols-2 gap-1.5">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-24 rounded-lg border bg-surface/70" />
                ))}
              </div>
              <span className="sr-only">Loading your session…</span>
            </div>
          ) : (
            <MoodChat initialMessages={history ?? []} />
          )}
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
