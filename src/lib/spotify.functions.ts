import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SPOTIFY_SCOPES,
  exchangeToken,
  guessPeriod,
  signState,
  spotifyCreds,
  spotifyGet,
  toRow,
  type IngestRow,
} from "./spotify.server";

export const getSpotifyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const configured = Boolean(spotifyCreds());
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("spotify_connections")
      .select("display_name, last_synced_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      configured,
      connected: Boolean(data),
      displayName: data?.display_name ?? null,
      lastSyncedAt: data?.last_synced_at ?? null,
    };
  });

export const getSpotifyAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const creds = spotifyCreds();
    if (!creds) throw new Error("Spotify credentials are not set up yet.");
    const origin = new URL(data.origin).origin;
    const params = new URLSearchParams({
      client_id: creds.clientId,
      response_type: "code",
      redirect_uri: `${origin}/api/public/spotify/callback`,
      scope: SPOTIFY_SCOPES,
      state: signState(context.userId, origin),
      show_dialog: "true",
    });
    return { url: `https://accounts.spotify.com/authorize?${params}` };
  });

export const disconnectSpotify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("spotify_connections").delete().eq("user_id", context.userId);
    return { ok: true };
  });

type SyncProgress = {
  stage: string;
  done: number;
  total: number | null;
  finished: boolean;
  error?: string;
  result?: { imported: number; playlists: number; liked: number; recent: number };
};
const syncProgress = new Map<string, SyncProgress>();

export const getSyncProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return syncProgress.get(context.userId) ?? null;
  });

export const syncSpotifyLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const setP = (p: Partial<SyncProgress>) =>
      syncProgress.set(context.userId, {
        stage: "Starting…",
        done: 0,
        total: null,
        finished: false,
        ...syncProgress.get(context.userId),
        ...p,
      });
    setP({ finished: false, error: undefined, result: undefined });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conn } = await supabaseAdmin
      .from("spotify_connections")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Spotify is not connected.");

    let token = conn.access_token;
    if (new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
      const t = await exchangeToken({
        grant_type: "refresh_token",
        refresh_token: conn.refresh_token,
      });
      token = t.access_token;
      await supabaseAdmin
        .from("spotify_connections")
        .update({
          access_token: t.access_token,
          refresh_token: t.refresh_token ?? conn.refresh_token,
          expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", context.userId);
    }

    const rows: IngestRow[] = [];

    // Only playlists the user created themselves (skip followed/saved ones by others)
    const me = await spotifyGet<{ id: string }>(token, "/me");
    type Pl = { id: string; name: string; owner?: { id?: string } };
    const allPlaylists: Pl[] = [];
    let plNext: string | null = "/me/playlists?limit=50";
    while (plNext) {
      const page: { items: (Pl | null)[]; next: string | null } = await spotifyGet(token, plNext);
      for (const p of page.items ?? []) if (p && p.owner?.id === me.id) allPlaylists.push(p);
      plNext = page.next;
    }
    const playlists = { items: allPlaylists };

    type PlItems = {
      items: {
        added_at: string;
        track?: Parameters<typeof toRow>[0];
        item?: Parameters<typeof toRow>[0];
      }[];
      next: string | null;
    };
    for (const pl of allPlaylists) {
      try {
        // Spotify renamed /tracks → /items (2026); try the new endpoint first.
        let first: PlItems;
        let base = "items";
        try {
          first = await spotifyGet<PlItems>(token, `/playlists/${pl.id}/items?limit=100`);
        } catch {
          base = "tracks";
          first = await spotifyGet<PlItems>(token, `/playlists/${pl.id}/tracks?limit=100`);
        }
        const items = [...(first.items ?? [])];
        let next = first.next;
        while (next) {
          const page = await spotifyGet<PlItems>(token, next);
          items.push(...(page.items ?? []));
          next = page.next;
        }
        void base;
        const norm = items.map((it) => ({ ...it, track: it.track ?? it.item }));
        const firstAdded = norm[0]?.added_at?.slice(0, 7);
        const period = guessPeriod(pl.name) ?? (firstAdded ? `${firstAdded}-01` : null);
        for (const it of norm) {
          const r = toRow(it.track, "playlist", pl.name, period);
          if (r) rows.push(r);
        }
      } catch (e) {
        console.error("playlist fetch failed", pl.name, e);
      }
    }

    // All saved tracks (paginated)
    for (let offset = 0; ; offset += 50) {
      const saved = await spotifyGet<{
        items: { added_at: string; track: Parameters<typeof toRow>[0] }[];
        next: string | null;
      }>(token, `/me/tracks?limit=50&offset=${offset}`);
      for (const it of saved.items ?? []) {
        const r = toRow(it.track, "saved", "Liked Songs", `${it.added_at.slice(0, 7)}-01`);
        if (r) rows.push(r);
      }
      if (!saved.next) break;
    }

    // Recently played
    try {
      const recent = await spotifyGet<{
        items: { played_at: string; track: Parameters<typeof toRow>[0] }[];
      }>(token, "/me/player/recently-played?limit=50");
      for (const it of recent.items ?? []) {
        const r = toRow(it.track, "recent", "Recently played", `${it.played_at.slice(0, 7)}-01`);
        if (r) rows.push(r);
      }
    } catch (e) {
      console.error("recent fetch failed", e);
    }

    // Dedupe on (spotify_id, source_name)
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      const k = `${r.spotify_id}|${r.source_name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    for (let i = 0; i < unique.length; i += 500) {
      const { error } = await context.supabase.from("library_tracks").upsert(
        unique.slice(i, i + 500).map((r) => ({ ...r, user_id: context.userId, is_demo: false })),
        { onConflict: "user_id,spotify_id,source_name" },
      );
      if (error) throw new Error(error.message);
    }
    await supabaseAdmin
      .from("spotify_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", context.userId);

    return { imported: unique.length, playlists: playlists.items?.length ?? 0 };
  });
