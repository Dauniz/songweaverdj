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
    // Reconnecting Spotify can recreate the connection row without a sync time even though
    // the library is already imported — fall back to the newest imported track.
    let lastSyncedAt = data?.last_synced_at ?? null;
    if (data && !lastSyncedAt) {
      const { data: latest } = await supabaseAdmin
        .from("library_tracks")
        .select("created_at")
        .eq("user_id", context.userId)
        .eq("is_demo", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      lastSyncedAt = latest?.created_at ?? null;
    }
    return {
      configured,
      connected: Boolean(data),
      displayName: data?.display_name ?? null,
      lastSyncedAt,
    };
  });

type SpotifyConnection = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const deviceCache = new Map<string, { id: string; name: string; at: number }>();
const deviceInit = new Map<string, number>();

async function spotifyAccess(userId: string, marginMs = 60_000) {
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt >= Date.now() + marginMs) return cached.token;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  const conn = data as SpotifyConnection | null;
  if (!conn) {
    tokenCache.delete(userId);
    return null;
  }
  const exp = new Date(conn.expires_at).getTime();
  if (exp >= Date.now() + marginMs) {
    tokenCache.set(userId, { token: conn.access_token, expiresAt: exp });
    return conn.access_token;
  }
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
  tokenCache.set(userId, { token: refreshed.access_token, expiresAt: Date.now() + refreshed.expires_in * 1000 });
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
  deviceId: z.string().min(1).max(128).optional(),
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

/** Resume Spotify where it was paused — for the play button in the maze. */
export const resumeSpotifyPlayback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = await spotifyAccess(context.userId);
    if (!token) return { ok: false };
    await fetch("https://api.spotify.com/v1/me/player/play", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    return { ok: true };
  });

/** Skip to the next song — acts exactly like the listener pressing next in Spotify. */
export const nextSpotifyTrack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = await spotifyAccess(context.userId);
    if (!token) return { ok: false };
    await fetch("https://api.spotify.com/v1/me/player/next", {
      method: "POST",
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
    // [now, "if you skip", skip-ahead]: the skip door already has its own skip song queued,
    // so landing on it never needs a mid-song resend (Spotify re-buffers audibly on resend).
    const chain = [data.spotifyId, ...(data.nextId ? [data.nextId] : []), ...(data.nextId && data.aheadId ? [data.aheadId] : [])];
    const uris = [...new Set(chain)].slice(0, 3).map((id) => `spotify:track:${id}`);
    const body = JSON.stringify({ uris, ...(data.positionMs ? { position_ms: data.positionMs } : {}) });

    const pickDevice = async () => {
      const r = await fetch("https://api.spotify.com/v1/me/player/devices", { headers });
      if (!r.ok) return { fail: playbackFailure(r.status, await r.text()) };
      const b = (await r.json()) as {
        devices?: { id: string | null; is_active: boolean; is_restricted: boolean; name: string }[];
      };
      const d = b.devices?.find((i) => i.is_active && !i.is_restricted && i.id)
        ?? b.devices?.find((i) => !i.is_restricted && i.id);
      if (!d?.id) return { fail: { status: "no_device" as const, message: "Spotify needs to be open on one of your devices." } };
      const dev = { id: d.id, name: d.name, at: Date.now() };
      // A sleeping desktop app can freeze when fed songs cold — wake it with an official transfer first.
      if (!d.is_active) {
        await fetch("https://api.spotify.com/v1/me/player", {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ device_ids: [d.id], play: false }),
        }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 500));
      }
      deviceCache.set(context.userId, dev);
      return { dev };
    };
    const send = (id: string) =>
      fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body,
      });

    // Reuse the last device (saves a round trip); only ask Spotify for devices when it fails.
    // Only trust the cached device if it was used recently; otherwise it may have gone to sleep.
    const t0 = Date.now();
    const cachedDev = deviceCache.get(context.userId);
    // The browser knows the device that's playing right now — use it first (no device lookup).
    let device = data.deviceId
      ? { id: data.deviceId, name: cachedDev?.id === data.deviceId ? cachedDev.name : "Spotify", at: Date.now() }
      : cachedDev && Date.now() - cachedDev.at < 90_000 ? cachedDev : null;
    let response: Response | null = device ? await send(device.id) : null;
    if (!response || !response.ok) {
      deviceCache.delete(context.userId);
      const picked = await pickDevice();
      if (picked.fail) return picked.fail;
      device = picked.dev;
      response = await send(device.id);
    }
    if (!response.ok) {
      deviceCache.delete(context.userId);
      return playbackFailure(response.status, await response.text());
    }
    deviceCache.set(context.userId, { ...device!, at: Date.now() });
    // Answer right away; the client's once-a-second poll confirms the song actually plays.
    return { status: "playing" as const, deviceName: device!.name, foreignQueued: 0, spotifyMs: Date.now() - t0 };
  });

/** Counts songs in the listener's own "Next in queue" ahead of Crate's list. */
export const getForeignQueueCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().max(64)).max(3) }).parse(d))
  .handler(async ({ data, context }) => {
    const token = await spotifyAccess(context.userId);
    if (!token) return { count: 0 };
    try {
      const q = await fetch("https://api.spotify.com/v1/me/player/queue", { headers: { Authorization: `Bearer ${token}` } });
      if (!q.ok) return { count: 0 };
      const body = (await q.json()) as { queue?: { id?: string | null }[] };
      const ids = (body.queue ?? []).map((i) => i.id ?? "");
      const ours = new Set(data.ids);
      const firstOurs = ids.findIndex((id) => ours.has(id));
      return { count: firstOurs > 0 ? firstOurs : 0 };
    } catch {
      return { count: 0 };
    }
  });

export const getSpotifyPlayback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = await spotifyAccess(context.userId, 5 * 60_000);
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
      device?: { id?: string | null; name?: string };
    };
    // Repeat/shuffle would loop Crate's short line-up; turn them off once per device,
    // only after the song is confirmed playing so a freshly woken app isn't flooded.
    const devId = body.device?.id;
    if (body.is_playing && devId) {
      const initKey = `${context.userId}|${devId}`;
      if (Date.now() - (deviceInit.get(initKey) ?? 0) > 30 * 60_000) {
        deviceInit.set(initKey, Date.now());
        const headers = { Authorization: `Bearer ${token}` };
        const dev = `device_id=${encodeURIComponent(devId)}`;
        await Promise.all([
          fetch(`https://api.spotify.com/v1/me/player/repeat?state=off&${dev}`, { method: "PUT", headers }),
          fetch(`https://api.spotify.com/v1/me/player/shuffle?state=false&${dev}`, { method: "PUT", headers }),
        ]).catch(() => undefined);
      }
    }
    if (devId && body.is_playing) {
      const c = deviceCache.get(context.userId);
      if (c?.id === devId) c.at = Date.now();
    }
    return {
      status: "ready" as const,
      isPlaying: Boolean(body.is_playing),
      spotifyId: body.item?.id ?? null,
      progressMs: body.progress_ms ?? 0,
      durationMs: body.item?.duration_ms ?? 0,
      deviceName: body.device?.name ?? null,
      deviceId: body.device?.id ?? null,
      name: body.item?.name ?? "",
      artists: (body.item?.artists ?? []).map((a) => a.name).join(", "),
      album: body.item?.album?.name ?? null,
      imageUrl: body.item?.album?.images?.[0]?.url ?? null,
      spotifyUrl: body.item?.external_urls?.spotify ?? null,
    };
  });

/** The first song in Spotify's "next up" — used to confirm a skip door is really lined up. */
export const getNextQueuedId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = await spotifyAccess(context.userId);
    if (!token) return { id: null as string | null };
    try {
      const q = await fetch("https://api.spotify.com/v1/me/player/queue", { headers: { Authorization: `Bearer ${token}` } });
      if (!q.ok) return { id: null as string | null };
      const body = (await q.json()) as { queue?: { id?: string | null }[] };
      return { id: body.queue?.[0]?.id ?? null };
    } catch {
      return { id: null as string | null };
    }
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
    type Pl = { id: string; name: string; snapshot_id?: string; owner?: { id?: string } };
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
    // Genre tags per artist (one lookup per 50 artists). Best effort: sync never fails on this.
    const artistIds = [...new Set(unique.map((r) => r.artist_id).filter((x): x is string => !!x))];
    const genresBy = new Map<string, string>();
    setP({ stage: "Reading artist genres…", done: 0, total: artistIds.length });
    for (let i = 0; i < artistIds.length && !limited; i += 50) {
      try {
        if (i > 0) await pace(250);
        const res = await spotifyGet<{ artists: ({ id: string; genres?: string[] } | null)[] }>(
          token,
          `/artists?ids=${artistIds.slice(i, i + 50).join(",")}`,
        );
        for (const a of res.artists ?? [])
          if (a?.genres?.length) genresBy.set(a.id, a.genres.slice(0, 4).join(", "));
      } catch (e) {
        console.error("artist genres failed", e);
        break;
      }
      setP({ done: Math.min(i + 50, artistIds.length) });
    }
    for (const r of unique) r.genres = r.artist_id ? (genresBy.get(r.artist_id) ?? null) : null;

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
    // Remember playlist versions so quick syncs can skip unchanged playlists.
    if (!limited) {
      const snaps = allPlaylists
        .filter((p) => p.snapshot_id)
        .map((p) => ({ user_id: context.userId, playlist_id: p.id, snapshot_id: p.snapshot_id!, updated_at: new Date().toISOString() }));
      if (snaps.length) await supabaseAdmin.from("spotify_playlist_snapshots").upsert(snaps);
    }

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

/**
 * Quick sync: only what's new since the last sync — newly liked songs, additions to playlists
 * whose version changed, and the last (max 50) plays. Never re-reads the whole library.
 */
export const syncRecentSpotify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const uid = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conn } = await supabaseAdmin
      .from("spotify_connections")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    if (!conn) throw new Error("Spotify is not connected.");
    let token = conn.access_token;
    if (new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
      const t = await exchangeToken({ grant_type: "refresh_token", refresh_token: conn.refresh_token });
      token = t.access_token;
      await supabaseAdmin
        .from("spotify_connections")
        .update({
          access_token: t.access_token,
          refresh_token: t.refresh_token ?? conn.refresh_token,
          expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", uid);
    }
    const pace = (ms = 300) => new Promise((r) => setTimeout(r, ms));
    const since = conn.last_synced_at ? Date.parse(conn.last_synced_at) : 0;
    const rows: IngestRow[] = [];
    let newLiked = 0;
    let changedPlaylists = 0;

    // 1) Newly liked songs — newest first, stop at the first one already seen.
    for (let offset = 0; offset < 1000; offset += 50) {
      const saved: { items: { added_at: string; track: Parameters<typeof toRow>[0] }[]; next: string | null } =
        await spotifyGet(token, `/me/tracks?limit=50&offset=${offset}`);
      let reachedOld = false;
      for (const it of saved.items ?? []) {
        if (Date.parse(it.added_at) <= since) {
          reachedOld = true;
          break;
        }
        const r = toRow(it.track, "saved", "Liked Songs", `${it.added_at.slice(0, 7)}-01`);
        if (r) {
          rows.push(r);
          newLiked += 1;
        }
      }
      if (reachedOld || !saved.next || !since) break;
      await pace();
    }

    // 2) Playlists whose version changed since last time.
    try {
      const me = await spotifyGet<{ id: string }>(token, "/me");
      type Pl = { id: string; name: string; snapshot_id?: string; owner?: { id?: string } };
      const mine: Pl[] = [];
      let next: string | null = "/me/playlists?limit=50";
      while (next) {
        const page: { items: (Pl | null)[]; next: string | null } = await spotifyGet(token, next);
        for (const p of page.items ?? []) if (p && p.owner?.id === me.id) mine.push(p);
        next = page.next;
        if (next) await pace();
      }
      const { data: snapRows } = await supabaseAdmin
        .from("spotify_playlist_snapshots")
        .select("playlist_id, snapshot_id")
        .eq("user_id", uid);
      const known = new Map((snapRows ?? []).map((s) => [s.playlist_id, s.snapshot_id]));
      const firstRun = known.size === 0; // no versions saved yet: just record them
      type PlItems = {
        items: { added_at: string; track?: Parameters<typeof toRow>[0]; item?: Parameters<typeof toRow>[0] }[];
        next: string | null;
      };
      if (!firstRun) {
        for (const pl of mine) {
          if (known.get(pl.id) === pl.snapshot_id) continue;
          changedPlaylists += 1;
          await pace(400);
          let page: PlItems;
          try {
            page = await spotifyGet<PlItems>(token, `/playlists/${pl.id}/items?limit=100`);
          } catch {
            page = await spotifyGet<PlItems>(token, `/playlists/${pl.id}/tracks?limit=100`);
          }
          const items = [...(page.items ?? [])];
          let n = page.next;
          while (n) {
            await pace();
            const p: PlItems = await spotifyGet(token, n);
            items.push(...(p.items ?? []));
            n = p.next;
          }
          const firstAdded = items[0]?.added_at?.slice(0, 7);
          const period = guessPeriod(pl.name) ?? (firstAdded ? `${firstAdded}-01` : null);
          const isNew = !known.has(pl.id);
          for (const it of items) {
            if (!isNew && it.added_at && Date.parse(it.added_at) <= since) continue;
            const r = toRow(it.track ?? it.item, "playlist", pl.name, period);
            if (r) rows.push(r);
          }
        }
      }
      const snaps = mine
        .filter((p) => p.snapshot_id)
        .map((p) => ({ user_id: uid, playlist_id: p.id, snapshot_id: p.snapshot_id!, updated_at: new Date().toISOString() }));
      if (snaps.length) await supabaseAdmin.from("spotify_playlist_snapshots").upsert(snaps);
    } catch (e) {
      console.error("quick playlist sync failed", e);
    }

    // Save new library rows (with genres for new artists only).
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      const k = `${r.spotify_id}|${r.source_name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const artistIds = [...new Set(unique.map((r) => r.artist_id).filter((x): x is string => !!x))];
    const genresBy = new Map<string, string>();
    for (let i = 0; i < artistIds.length; i += 50) {
      try {
        const res = await spotifyGet<{ artists: ({ id: string; genres?: string[] } | null)[] }>(
          token,
          `/artists?ids=${artistIds.slice(i, i + 50).join(",")}`,
        );
        for (const a of res.artists ?? []) if (a?.genres?.length) genresBy.set(a.id, a.genres.slice(0, 4).join(", "));
      } catch {
        break;
      }
    }
    for (const r of unique) r.genres = r.artist_id ? (genresBy.get(r.artist_id) ?? null) : null;
    if (unique.length) {
      const { error } = await context.supabase.from("library_tracks").upsert(
        unique.map((r) => ({ ...r, user_id: uid, is_demo: false })),
        { onConflict: "user_id,spotify_id,source_name" },
      );
      if (error) throw new Error(error.message);
    }

    // 3) Recent plays (Spotify shares at most the last 50).
    let recentPlays = 0;
    try {
      const after = conn.last_recent_sync_at ? Date.parse(conn.last_recent_sync_at) : 0;
      const rp: { items: { played_at: string; track: { id: string; duration_ms?: number } | null }[] } =
        await spotifyGet(token, `/me/player/recently-played?limit=50${after ? `&after=${after}` : ""}`);
      const byId = new Map<string, { plays: string[]; ms: number }>();
      for (const it of rp.items ?? []) {
        if (!it.track?.id) continue;
        const g = byId.get(it.track.id) ?? { plays: [], ms: 0 };
        g.plays.push(it.played_at);
        g.ms += it.track.duration_ms ?? 0;
        byId.set(it.track.id, g);
      }
      const ids = [...byId.keys()];
      if (ids.length) {
        const { data: existing } = await context.supabase
          .from("listening_history")
          .select("spotify_id, plays, ms_played, first_played, last_played, plays_by_year")
          .in("spotify_id", ids);
        const ex = new Map((existing ?? []).map((e) => [e.spotify_id, e]));
        const upserts = [];
        for (const [id, g] of byId) {
          const old = ex.get(id);
          const oldLast = old?.last_played ? Date.parse(old.last_played) : 0;
          const fresh = g.plays.filter((p) => Date.parse(p) > oldLast).sort();
          if (!fresh.length) continue;
          const avgMs = g.ms / g.plays.length;
          const pby = { ...((old?.plays_by_year as Record<string, number> | null) ?? {}) };
          for (const p of fresh) {
            const y = p.slice(0, 4);
            pby[y] = (pby[y] ?? 0) + 1;
          }
          recentPlays += fresh.length;
          upserts.push({
            user_id: uid,
            spotify_id: id,
            plays: (old?.plays ?? 0) + fresh.length,
            ms_played: Number(old?.ms_played ?? 0) + Math.round(avgMs * fresh.length),
            first_played: old?.first_played ?? fresh[0] ?? null,
            last_played: fresh[fresh.length - 1] ?? null,
            plays_by_year: pby,
          });
        }
        if (upserts.length) {
          const { error } = await context.supabase
            .from("listening_history")
            .upsert(upserts, { onConflict: "user_id,spotify_id" });
          if (error) console.error("recent history save failed", error.message);
        }
      }
    } catch (e) {
      console.error("recently-played failed", e);
    }

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("spotify_connections")
      .update({ last_synced_at: now, last_recent_sync_at: now })
      .eq("user_id", uid);
    return { newSongs: unique.length, newLiked, changedPlaylists, recentPlays };
  });
