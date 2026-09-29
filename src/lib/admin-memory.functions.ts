import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Admin-only: every tester's Walrus memory mirror + listening stats, for hackathon reporting. */
export const getAllTesterMemories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [usersRes, mem, conns, events] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 200 }),
      supabaseAdmin
        .from("memory_nodes")
        .select("id, user_id, kind, content, origin, status, blob_id, created_at")
        .order("created_at", { ascending: false })
        .limit(5000),
      supabaseAdmin.from("spotify_connections").select("user_id, display_name, last_synced_at"),
      supabaseAdmin
        .from("listening_events")
        .select("user_id, event, created_at")
        .order("created_at", { ascending: false })
        .limit(20000),
    ]);

    const connBy = new Map((conns.data ?? []).map((c) => [c.user_id, c]));
    const stats = new Map<string, { plays: number; skips: number; sessions: Set<string>; last: string | null }>();
    for (const e of events.data ?? []) {
      const s = stats.get(e.user_id) ?? { plays: 0, skips: 0, sessions: new Set(), last: null };
      if (e.event.includes("skip")) s.skips++;
      else s.plays++;
      s.last ??= e.created_at;
      stats.set(e.user_id, s);
    }

    const users = (usersRes.data?.users ?? []).map((u) => {
      const s = stats.get(u.id);
      const memories = (mem.data ?? []).filter((m) => m.user_id === u.id);
      return {
        id: u.id,
        email: u.email ?? null,
        isGuest:
          Boolean((u as { is_anonymous?: boolean }).is_anonymous) ||
          !u.email ||
          u.email.toLowerCase().startsWith("guest"),
        spotifyName: connBy.get(u.id)?.display_name ?? null,
        spotifyConnected: connBy.has(u.id),
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at ?? null,
        lastListen: s?.last ?? null,
        plays: s?.plays ?? 0,
        skips: s?.skips ?? 0,
        memories,
      };
    });
    users.sort((a, b) => b.memories.length - a.memories.length);
    return { users };
  });
