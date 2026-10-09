import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readAllRows } from "./keyset";
import { CURRENT_FAV_DAYS, defaultSuggestionMix } from "./pick-rules";
import { computeCooldowns, songKey, type CooldownEvent } from "./cooldowns";
import { dedupePicks } from "./dedupe-picks";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const partOf = (h: number) => (h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night");

export type SuggestedTrack = {
  id: string;
  spotify_id: string;
  name: string;
  artists: string;
  album: string | null;
  image_url: string | null;
  spotify_url: string | null;
  source_name: string;
};
export type StudioSuggestions = { title: string; pattern: boolean; tracks: SuggestedTrack[] };

type Row = SuggestedTrack & { genres: string | null };
type Song = Row & { plays?: number; last_played?: string | null; plays_by_year?: Record<string, number> | null };

/** 8 songs for the Studio start screen: a weekday/time habit when Crate has one, else the default mix. */
export const getStudioSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tzOffsetMin: z.number().int().min(-900).max(900) }).parse(d))
  .handler(async ({ data, context }): Promise<StudioSuggestions> => {
    const { supabase, userId } = context;
    const localNow = new Date(Date.now() - data.tzOffsetMin * 60_000);
    const day = localNow.getUTCDay();
    const hour = localNow.getUTCHours();
    const part = partOf(hour);

    const since = new Date(Date.now() - 56 * 864e5).toISOString();
    const [rows, history, { data: events }, { data: strong }] = await Promise.all([
      readAllRows<Row>(supabase, "library_tracks", "id, spotify_id, name, artists, album, image_url, spotify_url, source_name, genres", "id", userId, 30000),
      readAllRows<{ spotify_id: string; plays: number; last_played: string | null; plays_by_year: unknown }>(
        supabase, "listening_history", "spotify_id, plays, last_played, plays_by_year", "spotify_id", userId,
      ),
      supabase.from("listening_events").select("created_at, event, artists, track_name, track_id, session_id").gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
      supabase.from("memory_nodes").select("kind, content, origin").in("origin", ["cross_session", "history_profile"]).order("created_at", { ascending: false }).limit(30),
    ]);

    // Merge the library by Spotify id and attach imported history.
    const byId = new Map<string, Song>();
    for (const r of rows) if (!byId.has(r.spotify_id)) byId.set(r.spotify_id, { ...r });
    for (const h of history) {
      const s = byId.get(h.spotify_id);
      if (s) Object.assign(s, { plays: h.plays, last_played: h.last_played, plays_by_year: (h.plays_by_year as Record<string, number> | null) ?? null });
    }

    // Never: songs resting on cooldown, resting artists, or one of the last 50 heard.
    const evs = (events ?? []) as (CooldownEvent & { track_id: string | null })[];
    const cd = computeCooldowns(evs.filter((e) => Date.now() - new Date(e.created_at).getTime() < 60 * 864e5));
    const restingSongs = new Set(cd.songs.map((s) => songKey(s.name, s.artists)));
    const restingArtists = new Set(cd.artists.map((a) => a.artists.toLowerCase()));
    const heard = new Set(evs.slice(0, 50).map((e) => songKey(e.track_name ?? "", e.artists ?? "")));
    const pool = [...byId.values()].filter((s) => {
      const k = songKey(s.name, s.artists);
      const main = s.artists.split(", ")[0]!.toLowerCase();
      return !restingSongs.has(k) && !heard.has(k) && !restingArtists.has(main) && !s.spotify_id.startsWith("local:");
    });
    if (!pool.length) return { title: "Picked for you", pattern: false, tracks: [] };

    // Current favorites: streams in the last 4 weeks (listening Crate saw, not skips).
    const recentByKey = new Map<string, number>();
    const cutoff = Date.now() - CURRENT_FAV_DAYS * 864e5;
    for (const e of evs) {
      if (new Date(e.created_at).getTime() < cutoff || /skip/i.test(e.event)) continue;
      const k = songKey(e.track_name ?? "", e.artists ?? "");
      recentByKey.set(k, (recentByKey.get(k) ?? 0) + 1);
    }
    const recent = new Map(pool.map((s) => [s.spotify_id, recentByKey.get(songKey(s.name, s.artists)) ?? 0]));

    const clean = (list: Song[]): SuggestedTrack[] =>
      list.map(({ id, spotify_id, name, artists, album, image_url, spotify_url, source_name }) => ({ id, spotify_id, name, artists, album, image_url, spotify_url, source_name }));
    const fallback = (): StudioSuggestions => ({ title: "Picked for you", pattern: false, tracks: clean(defaultSuggestionMix(pool, recent)) });

    // Pattern: same weekday, ±2h, 3+ sessions, plus strong memories.
    const sessions = new Set<string>();
    const artistFin = new Map<string, number>();
    for (const e of evs) {
      const t = new Date(new Date(e.created_at).getTime() - data.tzOffsetMin * 60_000);
      const dh = Math.abs(t.getUTCHours() - hour);
      if (t.getUTCDay() !== day || Math.min(dh, 24 - dh) > 2) continue;
      sessions.add(e.session_id ?? t.toISOString().slice(0, 10));
      if (/skip/i.test(e.event)) continue;
      const a = (e.artists ?? "").split(",")[0]!.trim().toLowerCase();
      if (a) artistFin.set(a, (artistFin.get(a) ?? 0) + 1);
    }
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (sessions.size < 3 || !(strong ?? []).length || !apiKey || !artistFin.size) return fallback();

    // Shortlist ~40: songs by the window's artists, then songs sharing their genres.
    const topArtists = [...artistFin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([a]) => a);
    const shuffle = <T,>(a: T[]) => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map(([, x]) => x);
    const byArtist = shuffle(pool.filter((s) => topArtists.includes(s.artists.split(", ")[0]!.toLowerCase())));
    const genres = new Set(byArtist.flatMap((s) => (s.genres ?? "").toLowerCase().split(/,\s*/).filter(Boolean)));
    const byGenre = shuffle(pool.filter((s) => (s.genres ?? "").toLowerCase().split(/,\s*/).some((g) => genres.has(g))));
    const shortlist = dedupePicks([...byArtist.slice(0, 25), ...byGenre]).slice(0, 40);
    if (shortlist.length < 8) return fallback();

    let recalled: { text: string }[] = [];
    try {
      const { recallMemories } = await import("./memwal.server");
      const { isForeverSkipMemory } = await import("./cooldowns");
      recalled = (await recallMemories(userId, `${DAYS[day]} ${part} listening habits`, 6)).filter((r) => !isForeverSkipMemory(r.text));
    } catch { /* optional */ }

    const prompt = `Now: ${DAYS[day]} ${part}. Sessions in this weekday/time window over 8 weeks: ${sessions.size}.
Artists they finish in this window: ${topArtists.join(", ")}
Strong memories:\n${(strong ?? []).map((m) => `- ${m.content}`).join("\n")}
Walrus recall:\n${recalled.map((r) => `- ${r.text}`).join("\n") || "- (none)"}
Shortlist (id | song — artist | genres):\n${shortlist.map((s) => `${s.spotify_id} | ${s.name} — ${s.artists} | ${s.genres ?? ""}`).join("\n")}

Pick exactly 8 different songs from the shortlist that fit their recurring ${DAYS[day]} ${part} habit. Reply ONLY with json:
{"title": "short header, e.g. 'Your ${DAYS[day]} ${part} picks'", "ids": ["8 ids from the shortlist"]}`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          messages: [
            { role: "system", content: "You are Crate, a careful music DJ. Only use ids from the shortlist." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) return fallback();
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = j.choices?.[0]?.message?.content ?? "";
      const out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { title?: string; ids?: string[] };
      const byShort = new Map(shortlist.map((s) => [s.spotify_id, s]));
      const chosen = (out.ids ?? []).map((id) => byShort.get(id)).filter((s): s is Song => !!s);
      const tracks = dedupePicks([...chosen, ...shortlist]).slice(0, 8);
      return { title: (out.title || `Your ${DAYS[day]} ${part} picks`).slice(0, 60), pattern: true, tracks: clean(tracks) };
    } catch (e) {
      console.error("studio suggestions failed", e);
      return fallback();
    }
  });
