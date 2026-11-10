import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { idsToPrune, LOG_KEEP, LOG_MIN_PLAYED } from "./session-log";

export type SessionLogEntry = {
  id: string;
  started_at: string;
  updated_at: string;
  seed_prompt: string;
  first_song: string;
  played_count: number;
  skipped_count: number;
};

const recordSchema = z.object({
  sessionId: z.string().min(1).max(100),
  startedAt: z.string().max(40),
  seedPrompt: z.string().max(2000),
  firstSong: z.string().max(300),
  playedCount: z.number().int().min(0).max(10000),
  skippedCount: z.number().int().min(0).max(10000),
  tracks: z.array(z.unknown()).max(100),
  resumeState: z.unknown(),
});

/** Upserts the running session into the log (called after finished songs and on end). */
export const recordSessionLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => recordSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.playedCount < LOG_MIN_PLAYED) return { ok: false };
    const { supabase, userId } = context;
    const started = Number.isNaN(Date.parse(data.startedAt)) ? new Date().toISOString() : data.startedAt;
    const { error } = await supabase.from("session_log").upsert(
      {
        user_id: userId,
        session_id: data.sessionId,
        started_at: started,
        updated_at: new Date().toISOString(),
        seed_prompt: data.seedPrompt.slice(0, 500),
        first_song: data.firstSong.slice(0, 200),
        played_count: data.playedCount,
        skipped_count: data.skippedCount,
        tracks: data.tracks as Json,
        resume_state: (data.resumeState ?? {}) as Json,
      },
      { onConflict: "user_id,session_id" },
    );
    if (error) throw new Error("Couldn't log the session");
    // Keep the log small: only the newest sessions stay.
    const { data: rows } = await supabase
      .from("session_log")
      .select("id")
      .order("started_at", { ascending: false })
      .range(0, LOG_KEEP + 50);
    const extra = idsToPrune(rows ?? []);
    if (extra.length) await supabase.from("session_log").delete().in("id", extra);
    return { ok: true };
  });

export const listSessionLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("session_log")
      .select("id, started_at, updated_at, seed_prompt, first_song, played_count, skipped_count")
      .order("started_at", { ascending: false })
      .limit(LOG_KEEP);
    if (error) throw new Error("Couldn't load your sessions");
    return (data ?? []) as SessionLogEntry[];
  });

/** Full resume data for one logged session (to continue it in the Studio). */
export const getLoggedSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("session_log")
      .select("resume_state")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) throw new Error("Couldn't find that session");
    return { resume_state: row.resume_state };
  });

/** Copies a logged session into the Songbook with a name and description. */
export const saveLoggedToSongbook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), name: z.string().max(200), description: z.string().max(1000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const name = data.name.trim().slice(0, 60);
    if (!name) throw new Error("Give it a name");
    const { data: row, error } = await context.supabase
      .from("session_log")
      .select("tracks, resume_state")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) throw new Error("Couldn't find that session");
    const { error: insErr } = await context.supabase.from("songbook_entries").insert({
      user_id: context.userId,
      name,
      description: data.description.trim().slice(0, 200),
      tracks: row.tracks,
      resume_state: row.resume_state,
    });
    if (insErr) throw new Error("Couldn't save to your Songbook");
    return { ok: true };
  });
