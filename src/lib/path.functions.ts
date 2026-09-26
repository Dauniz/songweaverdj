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
  if (lens === "archive") {
    const dated = pool
      .map((s) => ({ s, m: Math.min(...s.sources.map((x) => monthIndex(x.period) ?? Infinity)) }))
      .filter((x) => Number.isFinite(x.m))
      .sort((a, b) => a.m - b.m);
    const oldest = dated.slice(0, Math.max(20, Math.floor(dated.length * 0.3))).map((x) => x.s);
    return oldest.length >= 15 ? oldest : pool;
  }
  return pool;
}

function lensRule(lens: LensId | null, step: number) {
  switch (lens) {
    case "wormhole":
      return "LENS Wormhole: every candidate lives in several playlists. Prefer one that opens a DIFFERENT playlist/period than the anchor, to jump between chapters of their life.";
    case "archive":
      return "LENS Forgotten archive: candidates are the oldest saves in the library. Pick a forgotten gem that still fits the road.";
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

const MODEL = "openai/gpt-6-astra";

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
        "id, spotify_id, name, artists, album, image_url, preview_url, spotify_url, source_type, source_name, source_period",
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
    } else {
      bySpotify.set(r.spotify_id, { ...r, sources: [src] });
    }
  }
  const songs = [...bySpotify.values()];
  poolCache.set(userId, { at: Date.now(), songs });
  return songs;
}

function monthIndex(p: string | null) {
  if (!p) return null;
  const [y = 0, m = 1] = p.split("-").map(Number);
  return y * 12 + (m - 1);
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
  const months = anchor.sources.map((s) => monthIndex(s.period)).filter((m) => m !== null) as number[];
  const scored = pool.map((s) => {
    let score = 0;
    if (s.sources.some((x) => x.type === "playlist" && playlists.has(x.name))) score += 3;
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
    .filter((x) => x.score > 0.6)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
}

function describe(s: Song) {
  const src = s.sources
    .slice(0, 2)
    .map((x) => `${x.name}${x.period ? ` ${fmtPeriod(x.period)}` : ""}`)
    .join("; ");
  return `${s.name} — ${s.artists} [${src}]`;
}

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
    const available = applyCodeLens(data.lens, unlensed);
    const lensLabel = lensName(data.lens);
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

    let shortlist: Song[];
    if (data.road === "vibe") {
      const sameArtists = available.filter((s) => likedArtists.has(s.artists)).slice(0, 40);
      shortlist = [...sameArtists, ...shuffle(available).slice(0, 700)];
    } else {
      const era = anchor ? eraCandidates(anchor, available).slice(0, 250) : [];
      shortlist = [...era, ...shuffle(available).slice(0, 450)];
    }
    const seen = new Set<string>();
    shortlist = shortlist.filter((s) => (seen.has(s.spotify_id) ? false : (seen.add(s.spotify_id), true)));
    const index = new Map<string, Song>();
    const lines = shortlist.map((s, i) => {
      index.set(`T${i}`, s);
      return `T${i} | ${describe(s)}`;
    });

    const recalled = await recallMemories(
      userId,
      `${data.seedPrompt} ${data.seed.name} ${data.seed.artists}`,
      6,
    ).catch(() => []);

    const roadRule =
      data.road === "vibe"
        ? "Follow the VIBE: same mood, energy, setting and sonic feel as the songs they played through, regardless of era. Similar or adjacent artists are great."
        : data.road === "era"
          ? "Follow the ERA: songs from the same playlists / time period as the last song they played through, filtered by their steering chips."
          : "Their last two picks were skipped. Try a fresh angle: blend era and vibe, or change direction noticeably, to figure out what they're after.";

    const system = `You are Crate's radio DJ, picking ONE next song at a time like solving a maze.
Seed song: "${data.seed.name}" by ${data.seed.artists}.${data.seedPrompt ? `\nThe session started from: "${data.seedPrompt}".` : ""}
Played through (the road that works): ${liked.map((h) => `${h.name} — ${h.artists}`).join("; ") || "(only the seed so far)"}
Skipped (wrong turns, avoid similar): ${skipped.map((h) => `${h.name} — ${h.artists}`).join("; ") || "(none)"}
${data.chips.length ? `Steering chips the user tapped (must respect): ${data.chips.join(", ")}.` : ""}
${roadRule}
${lensRule(data.lens, data.history.length)}
Favorites in memory are hints about taste, not a rotation list.
Walrus Memory:
${recalled.map((m: { text: string }) => `- ${m.text}`).join("\n") || "- (none)"}

Candidates (code | title — artist [playlist period]):
${lines.join("\n")}

Call pick_next exactly once with one code from the list.`;

    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    const result = streamText({
      model: provider.responses(MODEL),
      system,
      messages: [{ role: "user", content: "Pick the next song." }],
      stopWhen: stepCountIs(1),
      providerOptions: { openai: { store: false, reasoningEffort: "low" } },
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
