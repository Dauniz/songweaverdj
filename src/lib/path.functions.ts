import { createServerFn } from "@tanstack/react-start";
import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recallMemories } from "./memwal.server";
import { LENS_IDS, lensName, type LensId } from "./lenses";

const distinctPlaylists = (s: { sources: { name: string; type: string }[] }) =>
  new Set(s.sources.filter((x) => x.type === "playlist").map((x) => x.name)).size;

/** Code lenses narrow the pool before any road runs; AI lenses add a rule to the DJ prompt. */
function applyCodeLens<T extends { sources: { name: string; type: string; period: string | null }[] }>(
  lens: LensId | null,
  pool: T[],
): T[] {
  if (lens === "wormhole") {
    const hubs = pool.filter((s) => distinctPlaylists(s) >= 2);
    return hubs.length >= 15 ? hubs : pool;
  }
  return pool;
}

/** Deep cuts: songs saved in at most one place, last added 12+ months ago (forgotten, not staples). */
function applyDeepCuts<T extends { sources: { period: string | null }[] }>(pool: T[]): T[] {
  const now = new Date();
  const cutoff = now.getUTCFullYear() * 12 + now.getUTCMonth() - 12;
  const deep = pool.filter((s) => {
    if (s.sources.length > 1) return false;
    const months = s.sources.map((x) => monthIndex(x.period)).filter((m): m is number => m !== null);
    return months.length > 0 && Math.max(...months) <= cutoff;
  });
  return deep.length >= 15 ? deep : pool;
}

function lensRule(lens: LensId | null, step: number) {
  switch (lens) {
    case "wormhole":
      return "LENS Wormhole: every candidate lives in several playlists. Prefer one that opens a DIFFERENT playlist/period than the anchor, to jump between chapters of their life.";
    case "scene":
      return "LENS Scene: follow the artist web — collaborators, featured artists, same label or same regional scene as the anchor.";
    case "wave": {
      const phase = step % 5;
      return phase < 3
        ? `LENS Wave: building phase (${phase + 1}/3). Pick something a notch MORE energetic than the anchor.`
        : "LENS Wave: release phase. Pick something calmer to let the energy come down.";
    }
    case "texture":
      return "LENS Texture: match the sonic texture of the anchor — acoustic/organic stays acoustic, synth/electronic stays electronic — regardless of era.";
    default:
      return "";
  }
}

const MODEL = "openai/gpt-6-luna";

type Row = {
  id: string;
  spotify_id: string;
  name: string;
  artists: string;
  album: string | null;
  image_url: string | null;
  preview_url: string | null;
  spotify_url: string | null;
  source_type: string;
  source_name: string;
  source_period: string | null;
  genres: string | null;
};

/** One unique song across all playlists, remembering every place it lives. */
type Song = Row & { sources: { name: string; type: string; period: string | null }[] };

// Short-lived per-worker cache of the merged library (plain cache, not state).
const poolCache = new Map<string, { at: number; songs: Song[] }>();

async function loadPool(supabase: any, userId: string): Promise<Song[]> {
  const hit = poolCache.get(userId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.songs;
  const rows: Row[] = [];
  for (let from = 0; from < 30000; from += 1000) {
    const { data } = await supabase
      .from("library_tracks")
      .select(
        "id, spotify_id, name, artists, album, image_url, preview_url, spotify_url, source_type, source_name, source_period, genres",
      )
      .order("id")
      .range(from, from + 999);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const bySpotify = new Map<string, Song>();
  for (const r of rows) {
    const src = { name: r.source_name, type: r.source_type, period: r.source_period };
    const existing = bySpotify.get(r.spotify_id);
    if (existing) {
      existing.sources.push(src);
      if (!existing.image_url && r.image_url) existing.image_url = r.image_url;
      if (!existing.genres && r.genres) existing.genres = r.genres;
    } else {
      bySpotify.set(r.spotify_id, { ...r, sources: [src] });
    }
  }
  const songs = [...bySpotify.values()];
  poolCache.set(userId, { at: Date.now(), songs });
  return songs;
}

function dayIndex(p: string | null) {
  if (!p) return null;
  const d = new Date(p + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  return Math.round(d.getTime() / 86_400_000);
}

function fmtPeriod(p: string | null) {
  if (!p) return "";
  const d = new Date(p + "T00:00:00Z");
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = b[i]!;
    b[i] = b[j]!;
    b[j] = tmp;
  }
  return b;
}

/** Era road: same playlists / nearby months as the anchor. Plain code, no AI. */
function eraCandidates(anchor: Song, pool: Song[]) {
  const playlists = new Set(
    anchor.sources.filter((s) => s.type === "playlist").map((s) => s.name),
  );
  // Huge catch-all playlists mix every genre, so sharing one says little about fit.
  const size = new Map<string, number>();
  for (const s of pool)
    for (const x of s.sources)
      if (x.type === "playlist") size.set(x.name, (size.get(x.name) ?? 0) + 1);
  const playlistWeight = (name: string) => {
    const n = size.get(name) ?? 0;
    return n <= 120 ? 3 : n <= 400 ? 1.5 : 0.5;
  };
  const months = anchor.sources.map((s) => monthIndex(s.period)).filter((m) => m !== null) as number[];
  const scored = pool.map((s) => {
    let score = 0;
    let shared = 0;
    for (const x of s.sources)
      if (x.type === "playlist" && playlists.has(x.name)) shared = Math.max(shared, playlistWeight(x.name));
    score += shared;
    if (months.length) {
      let best = Infinity;
      for (const x of s.sources) {
        const m = monthIndex(x.period);
        if (m === null) continue;
        for (const am of months) best = Math.min(best, Math.abs(m - am));
      }
      if (best <= 2) score += 2 - best * 0.5;
      else if (best <= 6) score += 0.5;
    }
    if (s.artists === anchor.artists) score += 0.5;
    return { s, score: score + Math.random() * 0.4 };
  });
  return scored
    .filter((x) => x.score > 1.2)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
}


/** Compact one-line candidate: title—artist [playlist yy-mm]. Fewer tokens, same musical signal. */
function describe(s: Song) {
  const src = s.sources[0];
  const period = src?.period ? ` ${src.period.slice(0, 7)}` : "";
  const tag = src ? ` [${src.name.slice(0, 28)}${period}]` : "";
  const g = s.genres ? ` {${s.genres}}` : "";
  return `${s.name}—${s.artists}${g}${tag}`;
}

/** Pick up to n items from a list, skipping ones already chosen. */
function take<T extends { spotify_id: string }>(from: T[], n: number, seen: Set<string>) {
  const out: T[] = [];
  for (const s of from) {
    if (out.length >= n) break;
    if (seen.has(s.spotify_id)) continue;
    seen.add(s.spotify_id);
    out.push(s);
  }
  return out;
}

/**
 * Spread a sample across every corner of the library: round-robin over playlists
 * (and loose saves), so Crate can spot the same sound in a place the current playlist never reaches.
 */
function libraryWideSample(from: Song[], n: number, seen: Set<string>, preferForgotten = false) {
  const buckets = new Map<string, Song[]>();
  for (const s of from) {
    const key = s.sources[0]?.name ?? "_";
    const b = buckets.get(key) ?? [];
    b.push(s);
    buckets.set(key, b);
  }
  if (preferForgotten)
    for (const b of buckets.values())
      b.sort((a, c) => a.sources.length - c.sources.length);
  const lists = shuffle([...buckets.values()]);
  const out: Song[] = [];
  for (let round = 0; out.length < n && round < 50; round++) {
    let added = false;
    for (const b of lists) {
      if (out.length >= n) break;
      const s = b[round];
      if (!s) continue;
      added = true;
      if (seen.has(s.spotify_id)) continue;
      seen.add(s.spotify_id);
      out.push(s);
    }
    if (!added) break;
  }
  return out;
}

/**
 * Road-specific candidate pool (~75 songs). Each road gets candidates for its own mission:
 * - Vibe: artists working this session + a library-wide spread (forgotten songs first).
 *   No era or playlist-neighbour filtering — Crate judges sound, instruments and genre itself.
 * - Era: playlist neighbours and nearby months (time and chapter continuity).
 * - New angle: deliberate contrast — wide wildcards, avoiding the session's artists.
 */
function buildShortlist(
  road: "vibe" | "era" | "mixed",
  anchor: Song | undefined,
  available: Song[],
  likedArtists: Set<string>,
): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];
  const shuffled = shuffle(available);

  if (road === "vibe") {
    out.push(...take(shuffled.filter((s) => likedArtists.has(s.artists)), 20, seen));
    out.push(...libraryWideSample(shuffled, 55, seen, true));
    return out;
  }

  if (road === "era") {
    out.push(...take(shuffled.filter((s) => likedArtists.has(s.artists)), 10, seen));
    if (anchor) {
      const playlists = new Set(
        anchor.sources.filter((x) => x.type === "playlist").map((x) => x.name),
      );
      out.push(
        ...take(
          shuffled.filter((s) => s.sources.some((x) => x.type === "playlist" && playlists.has(x.name))),
          30,
          seen,
        ),
      );
      out.push(...take(eraCandidates(anchor, available), 30, seen));
    }
    out.push(...take(shuffled, 75 - out.length, seen));
    return out;
  }

  // New angle: step away from what's been playing.
  const fresh = shuffled.filter((s) => !likedArtists.has(s.artists));
  out.push(...libraryWideSample(fresh, 45, seen));
  out.push(...take(fresh, 30, seen));
  return out;
}

// Short-lived per-user cache of Crate's learned memory (same for both branch prefetches).
type MemoryBundle = {
  learned: { content: string; origin: string }[];
  walrusBy: Map<string, { text: string }[]>;
};
const memoryCache = new Map<string, { at: number; bundle: MemoryBundle }>();
const MEMORY_TTL = 90_000;


const reserveSchema = z.object({
  seed: z.object({ spotifyId: z.string(), name: z.string(), artists: z.string() }),
  road: z.enum(["vibe", "era", "mixed"]),
  lens: z.enum(LENS_IDS).nullable().default(null),
  deepCuts: z.boolean().default(false),
  avoidArtists: z.array(z.string().max(300)).max(30).default([]),
  excludeSpotifyIds: z.array(z.string()).max(600).default([]),
  count: z.number().int().min(1).max(4).default(2),
});

/**
 * Instant back-up songs for Spotify's line-up, chosen by plain code (no AI, no credits).
 * They sit behind the real "if you skip" door so rapid skips never run Spotify out of songs.
 */
export const pathReserves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => reserveSchema.parse(d))
  .handler(async ({ data, context }) => {
    const pool = await loadPool(context.supabase, context.userId);
    const excluded = new Set([data.seed.spotifyId, ...data.excludeSpotifyIds]);
    const avoid = new Set(data.avoidArtists);
    const playableOnly = pool.some((s) => !s.spotify_id.startsWith("demo-") || s.preview_url);
    const unlensed = pool.filter(
      (s) =>
        !excluded.has(s.spotify_id) &&
        !avoid.has(s.artists) &&
        !s.spotify_id.startsWith("demo-") &&
        (!playableOnly || !s.spotify_id.startsWith("demo-") || s.preview_url),
    );
    const available = data.deepCuts ? applyDeepCuts(unlensed) : applyCodeLens(data.lens, unlensed);
    if (!available.length) return { tracks: [] };
    const anchor = pool.find((s) => s.spotify_id === data.seed.spotifyId);
    const shortlist = buildShortlist(data.road, anchor, available, new Set([data.seed.artists]));
    const picks = shuffle(shortlist.slice(0, 80)).slice(0, data.count);
    return {
      tracks: picks.map((s) => ({
        id: s.id,
        spotify_id: s.spotify_id,
        name: s.name,
        artists: s.artists,
        album: s.album,
        image_url: s.image_url,
        preview_url: s.preview_url,
        spotify_url: s.spotify_url,
        source_name: s.source_name,
        source_type: s.source_type,
        period_label: fmtPeriod(s.source_period),
      })),
    };
  });


const inputSchema = z.object({
  seed: z.object({ spotifyId: z.string(), name: z.string(), artists: z.string() }),
  seedPrompt: z.string().max(1000).default(""),
  history: z
    .array(
      z.object({
        spotifyId: z.string(),
        name: z.string(),
        artists: z.string(),
        outcome: z.enum(["played", "skipped"]),
      }),
    )
    .max(25)
    .default([]),
  road: z.enum(["vibe", "era", "mixed"]),
  chips: z.array(z.string().max(40)).max(10).default([]),
  lens: z.enum(LENS_IDS).nullable().default(null),
  deepCuts: z.boolean().default(false),
  tzOffsetMin: z.number().int().min(-900).max(900).default(0),
  avoidArtists: z.array(z.string().max(300)).max(30).default([]),
  excludeSpotifyIds: z.array(z.string()).max(600).default([]),
});

export const nextPathTrack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const pool = await loadPool(supabase, userId);
    const bySpotify = new Map(pool.map((s) => [s.spotify_id, s]));

    const excluded = new Set([data.seed.spotifyId, ...data.excludeSpotifyIds]);
    const avoid = new Set(data.avoidArtists);
    const playableOnly = pool.some((s) => !s.spotify_id.startsWith("demo-") || s.preview_url);
    const unlensed = pool.filter(
      (s) =>
        !excluded.has(s.spotify_id) &&
        !avoid.has(s.artists) &&
        (!playableOnly || !s.spotify_id.startsWith("demo-") || s.preview_url),
    );
    const available = data.deepCuts ? applyDeepCuts(unlensed) : applyCodeLens(data.lens, unlensed);
    const lensLabel = data.deepCuts ? "Deep cuts" : lensName(data.lens);
    const withLens = (why: string) => (lensLabel ? `${lensLabel} · ${why}` : why);
    const aiLens = data.lens === "scene" || data.lens === "wave" || data.lens === "texture";
    if (!available.length) return { track: null, road: data.road, why: "Library exhausted" };

    // Anchor = last song played through, else the seed
    const lastPlayed = [...data.history].reverse().find((h) => h.outcome === "played");
    const anchor =
      bySpotify.get(lastPlayed?.spotifyId ?? data.seed.spotifyId) ??
      bySpotify.get(data.seed.spotifyId);

    const toTrack = (s: Song, why: string, road: "vibe" | "era" | "mixed") => ({
      road,
      why,
      track: {
        id: s.id,
        spotify_id: s.spotify_id,
        name: s.name,
        artists: s.artists,
        album: s.album,
        image_url: s.image_url,
        preview_url: s.preview_url,
        spotify_url: s.spotify_url,
        source_name: s.source_name,
        source_type: s.source_type,
        period_label: fmtPeriod(s.source_period),
      },
    });

    // ERA road without chips: pure code, instant.
    if (data.road === "era" && anchor && !data.chips.length && !aiLens) {
      const cands = eraCandidates(anchor, available);
      if (cands.length) {
        const pick = cands[Math.floor(Math.random() * Math.min(6, cands.length))]!;
        const shared = pick.sources.find((x) =>
          anchor.sources.some((a) => a.type === "playlist" && a.name === x.name),
        );
        const why = shared
          ? `Staying in ${shared.name}${shared.period ? ` · ${fmtPeriod(shared.period)}` : ""}`
          : `Same era · ${fmtPeriod(pick.source_period) || "around then"}`;
        return toTrack(pick, withLens(why), "era");
      }
    }

    // VIBE / MIXED (or era with chips): AI picks one from a shortlist.
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured.");

    const liked = data.history.filter((h) => h.outcome === "played").slice(-6);
    const skipped = data.history.filter((h) => h.outcome === "skipped").slice(-6);
    const likedArtists = new Set([data.seed.artists, ...liked.map((h) => h.artists)]);

    const shortlist = buildShortlist(data.road, anchor, available, likedArtists);
    const index = new Map<string, Song>();
    const lines = shortlist.map((s, i) => {
      index.set(`T${i}`, s);
      return `T${i}|${describe(s)}`;
    });


    // Local clock for the listener: lets Crate apply time-of-day / weekday rituals it learned.
    const local = new Date(Date.now() - data.tzOffsetMin * 60_000);
    const weekday = local.toLocaleString("en-US", { weekday: "long", timeZone: "UTC" });
    const hour = local.getUTCHours();
    const partOfDay = hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "late night";
    const nowLabel = `${weekday} ${partOfDay}, ${String(hour).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;

    const recallKey = `${weekday} ${partOfDay} ${data.seedPrompt} ${data.seed.name} ${data.seed.artists}`;
    const cachedMem = memoryCache.get(userId);
    const fresh = cachedMem && Date.now() - cachedMem.at < MEMORY_TTL ? cachedMem.bundle : null;

    const learned: { content: string; origin: string }[] = fresh
      ? fresh.learned
      : await supabase
          .from("memory_nodes")
          .select("content, origin, created_at")
          .or("origin.eq.cross_session,origin.eq.synthesis,content.like.Note on%")
          .order("created_at", { ascending: false })
          .limit(40)
          .then((r: { data: { content: string; origin: string }[] | null }) => r.data ?? []);

    const recalled: { text: string }[] =
      fresh?.walrusBy.get(recallKey) ?? (await recallMemories(userId, recallKey, 6).catch(() => []));

    const bundle: MemoryBundle = fresh ?? { learned, walrusBy: new Map() };
    bundle.walrusBy.set(recallKey, recalled);
    memoryCache.set(userId, { at: fresh ? (cachedMem?.at ?? Date.now()) : Date.now(), bundle });

    const anchors = learned.filter((m) => m.origin === "cross_session").slice(0, 6);
    const observations = learned.filter((m) => m.origin === "synthesis").slice(0, 4);
    const notes = learned.filter((m) => m.content.startsWith("Note on")).slice(0, 8);
    const seen = new Set(learned.map((m) => m.content));
    const walrus = recalled.filter((m: { text: string }) => ![...seen].some((c) => m.text.includes(c.slice(0, 40))));
    const bullets = (xs: { content: string }[]) => xs.map((m) => `- ${m.content}`).join("\n") || "- (none yet)";

    const roadRule =
      data.road === "vibe"
        ? "Follow the VIBE: use your own music knowledge of each artist's sound — instrumentation, production, genre, tempo, vocal style, mood — and pick the candidate that sounds closest to the songs they played through, regardless of era or which playlist it sits in. Prefer finding the same sound from a different artist or a forgotten corner of their library over the obvious neighbour."
        : data.road === "era"
          ? "Follow the ERA: songs from the same playlists / time period as the last song they played through, filtered by their steering chips."
          : "Their last two picks were skipped. Try a fresh angle: blend era and vibe, or change direction noticeably, to figure out what they're after.";

    // Cache-friendly order: fixed rules + learned memory first (stable across picks),
    // then candidates, and the live per-pick state last in the user message.
    const system = `You are Crate's radio DJ, picking ONE next song at a time like solving a maze.
Priority: live signals in this session (skips, chips, road, side road) beat learned memory. When live signals are neutral, let a matching learned pattern tip the choice. Favorites are hints about taste, not a rotation list.
If your pick was driven by a learned memory, say so briefly in "why" (e.g. "Your Sunday-evening Swedish ritual").
Call pick_next exactly once with one code from the candidate list.

What you have learned about this listener over time — use it to make the pick personal:
Durable patterns across many sessions (strongest; apply them, especially rituals matching the listener's current day and time):
${bullets(anchors)}
Recent single-session observations (weaker hints):
${bullets(observations)}
Things they told you about specific songs (Feedbacker — their own words, trust them):
${bullets(notes)}

Candidates (code|title—artist {Spotify genre tags, when known} [playlist yyyy-mm]). Use genre tags together with your own knowledge of the artist's sound:
${lines.join("\n")}`;

    const live = `It is ${nowLabel} (${weekday} ${partOfDay}) for the listener right now.
Seed song: "${data.seed.name}" by ${data.seed.artists}.${data.seedPrompt ? `\nThe session started from: "${data.seedPrompt}".` : ""}
Played through (the road that works): ${liked.map((h) => `${h.name} — ${h.artists}`).join("; ") || "(only the seed so far)"}
Skipped (wrong turns, avoid similar): ${skipped.map((h) => `${h.name} — ${h.artists}`).join("; ") || "(none)"}
${data.chips.length ? `Steering chips the user tapped (must respect): ${data.chips.join(", ")}.` : ""}
${roadRule}
${lensRule(data.lens, data.history.length)}${data.deepCuts ? "\nDEEP CUTS: prefer forgotten songs they saved long ago and rarely return to — never the obvious staples." : ""}
Other Walrus Memory relevant right now:
${walrus.map((m: { text: string }) => `- ${m.text}`).join("\n") || "- (none)"}

Pick the next song.`;

    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    const result = streamText({
      model: provider.responses(MODEL),
      system,
      messages: [{ role: "user", content: live }],
      stopWhen: stepCountIs(1),
      providerOptions: { openai: { store: false } },
      tools: {
        pick_next: tool({
          description: "Choose the next song.",
          inputSchema: z.object({
            code: z.string(),
            why: z.string().describe("Max 6 words, e.g. 'Same warm soul feel'"),
          }),
          execute: async (i) => i,
        }),
      },
    });
    const steps = await result.steps;
    let picked: { code: string; why: string } | null = null;
    for (const st of steps)
      for (const tc of st.toolCalls)
        if (tc.toolName === "pick_next") picked = tc.input as { code: string; why: string };

    const song = (picked && index.get(picked.code.trim())) || shortlist[0]!;
    return toTrack(song, withLens(picked?.why || "Continuing the path"), data.road);
  });
