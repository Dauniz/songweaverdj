import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRadio } from "./radio-context";
import type { CardTrack } from "./TrackCard";

type Msg = { role?: string; parts?: { type: string; text?: string }[] };

export function ContinueWhere({ onPrompt, disabled }: { onPrompt: (p: string) => void; disabled?: boolean }) {
  const { startRadio } = useRadio();

  const { data } = useQuery({
    queryKey: ["continue-where"],
    queryFn: async () => {
      const [msgs, events] = await Promise.all([
        supabase.from("chat_messages").select("message").order("created_at", { ascending: false }).limit(20),
        supabase
          .from("listening_events")
          .select("track_id")
          .in("event", ["play_through", "replay", "explicit_fav"])
          .not("track_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      let vibe: string | null = null;
      for (const row of msgs.data ?? []) {
        const m = row.message as Msg;
        if (m?.role !== "user") continue;
        const t = m.parts?.find((p) => p.type === "text")?.text?.split("\n\n(Filters:")[0]?.trim();
        if (t && t.length > 2) {
          vibe = t;
          break;
        }
      }
      const counts = new Map<string, number>();
      for (const e of events.data ?? []) if (e.track_id) counts.set(e.track_id, (counts.get(e.track_id) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      let track: CardTrack | null = null;
      if (top) {
        const { data: t } = await supabase
          .from("library_tracks")
          .select("id, spotify_id, name, artists, album, image_url, spotify_url, source_name")
          .eq("id", top[0])
          .maybeSingle();
        if (t) track = t as CardTrack;
      }
      return { vibe, track };
    },
  });

  if (!data || (!data.vibe && !data.track)) return null;

  return (
    <div className="mt-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Continue where you left off
      </p>
      <div className="flex flex-wrap gap-3">
        {data.vibe && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPrompt(data.vibe!)}
            className="flex min-h-14 max-w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 text-left hover:border-primary disabled:opacity-50"
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">Recent vibe</span>
              <span className="line-clamp-2 text-sm text-foreground">{data.vibe}</span>
            </span>
          </button>
        )}
        {data.track && (
          <button
            type="button"
            onClick={() => startRadio([data.track!], "")}
            className="group flex min-h-14 max-w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-primary"
          >
            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
              {data.track.image_url && <img src={data.track.image_url} alt="" className="h-full w-full object-cover" />}
              <span className="absolute inset-0 hidden place-items-center bg-background/60 group-hover:grid">
                <Play className="h-4 w-4 fill-current text-foreground" />
              </span>
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">You played this a lot</span>
              <span className="block truncate text-sm text-foreground">
                {data.track.name} · {data.track.artists}
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
