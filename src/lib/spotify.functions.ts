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

type SpotifyConnection = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

async function spotifyAccess(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  const conn = data as SpotifyConnection | null;
  if (!conn) return null;
  if (new Date(conn.expires_at).getTime() >= Date.now() + 60_000) return conn.access_token;
  const refreshed = await exchangeToken({ grant_type: "refresh_token", refresh_token: conn.refresh_token });
  await supabaseAdmin
    .from("spotify_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? conn.refresh_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return refreshed.access_token;
}

function playbackFailure(status: number, detail = "") {
  if (status === 401) return { status: "connect_required" as const, message: "Connect Spotify to control playback." };
  if (status === 403 && /premium/i.test(detail)) return { status: "premium_required" as const, message: "Spotify live playback requires a Premium account." };
  if (status === 403) return { status: "connect_required" as const, message: "Connect Spotify to grant playback permission." };
  if (status === 404) return { status: "no_device" as const, message: "Spotify needs to be open on one of your devices." };
  return { status: "unavailable" as const, message: "Spotify playback is temporarily unavailable." };
}

const playInput = z.object({ spotifyId: z.string().min(1).max(64) });
const startInput = playInput.extend({
  nextId: z.string().min(1).max(64).optional(),
  aheadId: z.string().min(1).max(64).optional(),
  positionMs: z.number().int().min(0).max(3_600_000).optional(),
});

/** Pause Spotify — used when the listener skips so fast that Crate needs a breath. */
export const pauseSpotifyPlayback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = await spotifyAccess(context.userId);
    if (!token) return { ok: false };
    await fetch("https://api.spotify.com/v1/me/player/pause", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    return { ok: true };
  });

/** Plays Crate's song as a fresh two-song list: [now, "if you skip"] — this replaces
 *  whatever album/playlist Spotify was running, so a skip lands on Crate's pick. */
export const playSpotifyTrack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => startInput.parse(d))
  .handler(async ({ data, context }) => {
    const token = await spotifyAccess(context.userId);
    if (!token) return { status: "connect_required" as const, message: "Connect Spotify to start listening." };
    const headers = { Authorization: `Bearer ${token}` };
    const devicesResponse = await fetch("https://api.spotify.com/v1/me/player/devices", { headers });
    if (!devicesResponse.ok) return playbackFailure(devicesResponse.status, await devicesResponse.text());
    const body = (await devicesResponse.json()) as {
      devices?: { id: string | null; is_active: boolean; is_restricted: boolean; name: string }[];
    };
    const device = body.devices?.find((item) => item.is_active && !item.is_restricted && item.id)
      ?? body.devices?.find((item) => !item.is_restricted && item.id);
    if (!device?.id) return { status: "no_device" as const, message: "Spotify needs to be open on one of your devices." };
    // [now, "if you skip", skip-ahead]: the skip door already has its own skip song queued,
    // so landing on it never needs a mid-song resend (Spotify re-buffers audibly on resend).
    const chain = [data.spotifyId, ...(data.nextId ? [data.nextId] : []), ...(data.nextId && data.aheadId ? [data.aheadId] : [])];
    const uris = [...new Set(chain)].slice(0, 3).map((id) => `spotify:track:${id}`);
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device.id)}`,
      {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ uris, ...(data.positionMs ? { position_ms: data.positionMs } : {}) }),
      },
    );

    if (!response.ok) return playbackFailure(response.status, await response.text());
    // Repeat/shuffle would loop Crate's short line-up (skip → same song again), so turn them off.
    const dev = `device_id=${encodeURIComponent(device.id)}`;
    await Promise.all([
      fetch(`https://api.spotify.com/v1/me/player/repeat?state=off&${dev}`, { method: "PUT", headers }),
      fetch(`https://api.spotify.com/v1/me/player/shuffle?state=false&${dev}`, { method: "PUT", headers }),
    ]).catch(() => undefined);

    // Spotify can acknowledge a play command even when a stale/inactive device never
    // starts it. Do not tell Songweaver it is playing until Spotify reports the requested
    // track as actively playing; otherwise the observer can react to stale player state.
    for (const delay of [250, 450, 700]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const verify = await fetch("https://api.spotify.com/v1/me/player", { headers }).catch(() => null);
      if (!verify?.ok || verify.status === 204) continue;
      const playback = (await verify.json()) as { is_playing?: boolean; item?: { id?: string | null } | null };
      if (playback.is_playing && playback.item?.id === data.spotifyId) {
        // Spotify's API cannot clear the listener's own "Next in queue", and those songs
        // play before Crate's list. Count them so Songweaver can ask the listener to clear it.
        let foreignQueued = 0;
        try {
          const q = await fetch("https://api.spotify.com/v1/me/player/queue", { headers });
          if (q.ok) {
            const body = (await q.json()) as { queue?: { id?: string | null }[] };
            const ids = (body.queue ?? []).map((i) => i.id ?? "");
            const ours = new Set(uris.slice(1).map((u) => u.replace("spotify:track:", "")));
            const firstOurs = ids.findIndex((id) => ours.has(id));
            foreignQueued = firstOurs > 0 ? firstOurs : 0;
          }
        } catch {
          /* optional check */
        }
        return { status: "playing" as const, deviceName: device.name, foreignQueued };
      }
    }
    return {
      status: "no_device" as const,
      message: "Spotify didn't start playback. Open Spotify on a device, then try again.",
    };
  });

export const getSpotifyPlayback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = await spotifyAccess(context.userId);
    if (!token) return { status: "connect_required" as const };
    const response = await fetch("https://api.spotify.com/v1/me/player", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 204) return { status: "idle" as const };
    if (!response.ok) return { status: playbackFailure(response.status).status };
    const body = (await response.json()) as {
      is_playing?: boolean;
      progress_ms?: number | null;
      item?: {
        id?: string | null;
        duration_ms?: number;
        name?: string;
        artists?: { name: string }[];
        album?: { name?: string; images?: { url: string }[] };
        external_urls?: { spotify?: string };
      } | null;
      device?: { name?: string };
    };
    return {
      status: "ready" as const,
      isPlaying: Boolean(body.is_playing),
      spotifyId: body.item?.id ?? null,
      progressMs: body.progress_ms ?? 0,
      durationMs: body.item?.duration_ms ?? 0,
      deviceName: body.device?.name ?? null,
      name: body.item?.name ?? "",
      artists: (body.item?.artists ?? []).map((a) => a.name).join(", "),
      album: body.item?.album?.name ?? null,
      imageUrl: body.item?.album?.images?.[0]?.url ?? null,
      spotifyUrl: body.item?.external_urls?.spotify ?? null,
    };
  });

/** Line up Crate's next pick in Spotify's own queue so skips inside the Spotify app land on it. */
export const queueSpotifyTrack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => playInput.parse(d))
  .handler(async ({ data, context }) => {
    const token = await spotifyAccess(context.userId);
    if (!token) return { ok: false };
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(`spotify:track:${data.spotifyId}`)}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    return { ok: response.ok };
  });

/** Ends a Songweaver session: pauses playback and restarts the current song on its
 *  own, so the two-song list Crate kept lined up (and its picks) are gone. Spotify's
 *  API cannot clear the queue directly, so replacing the context is the reset. */
export const endSpotifySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = await spotifyAccess(context.userId);
    if (!token) return { ok: false };
    const headers = { Authorization: `Bearer ${token}` };
    const state = await fetch("https://api.spotify.com/v1/me/player", { headers });
    let trackId: string | null = null;
    if (state.ok && state.status !== 204) {
      const text = await state.text();
      if (text) {
        try {
          const body = JSON.parse(text) as { item?: { id?: string | null } | null };
          trackId = body.item?.id ?? null;
        } catch {
          trackId = null;
        }
      }
    }
    if (trackId) {
      await fetch("https://api.spotify.com/v1/me/player/play", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: 0 }),
      });
    }
    await fetch("https://api.spotify.com/v1/me/player/pause", { method: "PUT", headers }).catch(() => undefined);
    return { ok: true };
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
  result?: { imported: number; playlists: number; liked: number };
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
    setP({ finished: false });
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

    // Spotify throttles bursts, so every paged request waits a beat.
    const pace = (ms = 250) => new Promise((r) => setTimeout(r, ms));

    const rows: IngestRow[] = [];
    let likedCount = 0;

    try {
    // Only playlists the user created themselves (skip followed/saved ones by others)
    setP({ stage: "Fetching your playlists…" });
    const me = await spotifyGet<{ id: string }>(token, "/me");
    type Pl = { id: string; name: string; owner?: { id?: string } };
    const allPlaylists: Pl[] = [];
    let plNext: string | null = "/me/playlists?limit=50";
    let limited = false;
    while (plNext) {
      try {
        const page: { items: (Pl | null)[]; next: string | null } = await spotifyGet(token, plNext);
        for (const p of page.items ?? []) if (p && p.owner?.id === me.id) allPlaylists.push(p);
        plNext = page.next;
        if (plNext) await pace();
      } catch (e) {
        console.error("playlist list failed", e);
        limited = true;
        break;
      }
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
    let plDone = 0;
    for (const pl of allPlaylists) {
      plDone += 1;
      if (limited) break;
      setP({
        stage: `Importing playlist ${plDone}/${allPlaylists.length}: ${pl.name}`,
        done: plDone,
        total: allPlaylists.length,
      });
      await pace(400);
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
          await pace();
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
        if (e instanceof Error && e.message.includes("limiting")) limited = true;
      }
    }

    // All saved tracks (paginated)
    setP({ stage: "Importing Liked Songs…", done: 0, total: null });
    for (let offset = 0; !limited; offset += 50) {
      let saved: {
        items: { added_at: string; track: Parameters<typeof toRow>[0] }[];
        next: string | null;
        total?: number;
      };
      try {
        if (offset > 0) await pace(300);
        saved = await spotifyGet(token, `/me/tracks?limit=50&offset=${offset}`);
      } catch (e) {
        console.error("liked fetch failed", e);
        limited = true;
        break;
      }
      for (const it of saved.items ?? []) {
        const r = toRow(it.track, "saved", "Liked Songs", `${it.added_at.slice(0, 7)}-01`);
        if (r) {
          rows.push(r);
          likedCount += 1;
        }
      }
      setP({ done: offset + (saved.items?.length ?? 0), total: saved.total ?? null });
      if (!saved.next) break;
    }

    // Dedupe on (spotify_id, source_name)
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      const k = `${r.spotify_id}|${r.source_name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (unique.length === 0 && limited) {
      throw new Error("Spotify is limiting requests right now. Wait a few minutes and try syncing again.");
    }
    setP({ stage: `Saving ${unique.length} tracks…`, done: 0, total: unique.length });
    for (let i = 0; i < unique.length; i += 500) {
      const { error } = await context.supabase.from("library_tracks").upsert(
        unique.slice(i, i + 500).map((r) => ({ ...r, user_id: context.userId, is_demo: false })),
        { onConflict: "user_id,spotify_id,source_name" },
      );
      if (error) throw new Error(error.message);
      setP({ done: Math.min(i + 500, unique.length) });
    }
    await supabaseAdmin
      .from("spotify_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", context.userId);

    const result = {
      imported: unique.length,
      playlists: playlists.items?.length ?? 0,
      liked: likedCount,
      partial: limited,
    };
    setP({ stage: "Done", finished: true, result });
    return result;
    } catch (e) {
      setP({
        finished: true,
        error: e instanceof Error ? e.message : "Sync failed",
      });
      throw e;
    }
  });
