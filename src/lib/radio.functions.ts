import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { submitMemory } from "./memwal.server";


const eventSchema = z.object({
  trackId: z.string().nullable(),
  trackName: z.string(),
  artists: z.string(),
  event: z.enum(["play_through", "early_skip", "replay", "explicit_fav", "explicit_skip", "steer"]),
  sessionId: z.string(),
  mode: z.enum(["era", "vibe", "mixed"]).nullable(),
});

type EventInput = z.infer<typeof eventSchema>;

async function saveSignalMemory(
  supabase: any,
  userId: string,
  kind: "taste" | "skipped" | "favorite" | "session",
  content: string,
) {
  // Avoid near-duplicate memories for the same track/artist
  const key = content.slice(0, 40);
  const { data: existing } = await supabase
    .from("memory_nodes")
    .select("id")
    .ilike("content", `${key}%`)
    .limit(1);
  if (existing?.length) return;
  const { jobId, error } = await submitMemory(userId, kind, content);
  await supabase.from("memory_nodes").insert({
    user_id: userId,
    kind,
    content,
    origin: "listening",
    blob_id: jobId ? `job:${jobId}` : null,
    status: jobId ? "pending" : error === "not_configured" ? "local" : "failed",
  });
}

export const logListeningEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => eventSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("listening_events").insert({
      user_id: userId,
      track_id: data.trackId,
      track_name: data.trackName,
      artists: data.artists,
      event: data.event,
      session_id: data.sessionId,
      mode: data.mode,
    });
    if (error) throw new Error(error.message);

    const learned: string[] = [];

    if (data.event === "explicit_fav") {
      await saveSignalMemory(
        supabase,
        userId,
        "favorite",
        `Loves "${data.trackName}" by ${data.artists} — resurface occasionally, don't overplay.`,
      );
      learned.push("favorite");
    }
    if (data.event === "replay") {
      // A replay in one sitting is a mood, not a verdict. Only remember it as a
      // gentle favorite once it's been replayed in 2+ different sessions.
      const { data: replays } = await supabase
        .from("listening_events")
        .select("session_id")
        .eq("event", "replay")
        .eq("track_name", data.trackName)
        .eq("artists", data.artists)
        .limit(50);
      const sessions = new Set((replays ?? []).map((r: { session_id: string | null }) => r.session_id));
      if (sessions.size >= 2) {
        await saveSignalMemory(
          supabase,
          userId,
          "favorite",
          `Keeps coming back to "${data.trackName}" by ${data.artists} — a quiet favorite. Resurface now and then, never on heavy rotation.`,
        );
        learned.push("favorite");
      }
    }
    // Skips never write permanent memories: they put songs/artists on a short cooldown
    // (see cooldowns.ts), computed from these logged events.
    if (data.event === "steer") {
      // A chip tapped in 3+ different sessions becomes a gentle taste memory.
      const { data: steers } = await supabase
        .from("listening_events")
        .select("session_id")
        .eq("event", "steer")
        .eq("track_name", data.trackName)
        .limit(100);
      const sessions = new Set((steers ?? []).map((r: { session_id: string | null }) => r.session_id));
      if (sessions.size >= 3) {
        await saveSignalMemory(
          supabase,
          userId,
          "taste",
          `Often steers the radio toward "${data.trackName}" — lean that way when unsure.`,
        );
        learned.push("steer");
      }
      return { ok: true, learned };
    }
    if (data.event === "play_through" && data.mode) {
      // 3 full plays in the same mode -> taste memory about what works
      const { count: plays } = await supabase
        .from("listening_events")
        .select("id", { count: "exact", head: true })
        .eq("event", "play_through")
        .eq("session_id", data.sessionId)
        .eq("mode", data.mode);
      if ((plays ?? 0) === 3) {
        await saveSignalMemory(
          supabase,
          userId,
          "session",
          data.mode === "era"
            ? `Era-based radio worked well — listened through several tracks from the same period.`
            : `Vibe-based radio worked well — listened through several mood-matched tracks.`,
        );
        learned.push("session");
      }
    }
    return { ok: true, learned };
  });
