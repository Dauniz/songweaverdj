import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

export type SongbookEntry = {
  id: string;
  name: string;
  description: string;
  tracks: Json;
  resume_state: Json;
  updated_at: string;
};

const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

export const listSongbook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("songbook_entries")
      .select("id, name, description, tracks, resume_state, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error("Couldn't load your Songbook");
    return (data ?? []) as SongbookEntry[];
  });

export const saveSongbook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; description: string; tracks: unknown[]; resume_state: unknown }) => d)
  .handler(async ({ data, context }) => {
    const name = clean(data.name, 60);
    if (!name) throw new Error("Give it a name");
    const tracks = (Array.isArray(data.tracks) ? data.tracks : []).slice(0, 100) as Json;
    const { error } = await context.supabase.from("songbook_entries").insert({
      user_id: context.userId,
      name,
      description: clean(data.description, 200),
      tracks,
      resume_state: (data.resume_state ?? {}) as Json,
    });
    if (error) throw new Error("Couldn't save to your Songbook");
    return { ok: true };
  });

export const updateSongbook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; name: string; description: string }) => d)
  .handler(async ({ data, context }) => {
    const name = clean(data.name, 60);
    if (!name) throw new Error("Give it a name");
    const { error } = await context.supabase
      .from("songbook_entries")
      .update({ name, description: clean(data.description, 200), updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error("Couldn't update it");
    return { ok: true };
  });

export const deleteSongbook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("songbook_entries").delete().eq("id", data.id);
    if (error) throw new Error("Couldn't delete it");
    return { ok: true };
  });
