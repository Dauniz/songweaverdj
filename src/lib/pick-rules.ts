// Crate's picking rules as plain, testable code.

/** A song is finished only when it actually reached its end (a few seconds of slack for Spotify lag). */
export const FINISH_SLACK_MS = 4_000;
export function isFinished(progressMs: number, durationMs: number) {
  return durationMs > 0 && durationMs - progressMs <= FINISH_SLACK_MS;
}

/** Forgotten favorite: more than 20 streams, and at most 3 streams in the last 6 months. */
export const FORGOTTEN_MIN_PLAYS = 20;
export const FORGOTTEN_RECENT_MAX = 3;
type Hist = { plays?: number; last_played?: string | null; plays_by_year?: Record<string, number> | null };
export function recentPlays(s: Hist, now = Date.now()) {
  if (!s.last_played) return 0;
  const sixMonths = now - 182 * 86_400_000;
  if (new Date(s.last_played).getTime() < sixMonths) return 0;
  // Only yearly counts are stored: estimate the 6-month share from this year and last year.
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const thisYear = s.plays_by_year?.[String(y)] ?? 0;
  const lastYear = s.plays_by_year?.[String(y - 1)] ?? 0;
  const month = d.getUTCMonth(); // 0-11
  if (month >= 6) return thisYear;
  return thisYear + Math.round(lastYear * ((6 - month) / 12));
}
export function isForgotten(s: Hist, now = Date.now()) {
  if (!s.plays || s.plays <= FORGOTTEN_MIN_PLAYS) return false;
  if (!s.last_played) return false;
  return recentPlays(s, now) <= FORGOTTEN_RECENT_MAX;
}

/** Era road scoring. */
export const ERA_CUTOFF = 2.5;
export function playlistWeight(size: number) {
  return size <= 20 ? 3 : size <= 120 ? 1.5 : 0.5;
}
export function savedCloseWeight(days: number) {
  return days <= 7 ? 2 : days <= 15 ? 1 : 0;
}

export type ShortSong = { spotify_id: string; artists: string; genres: string | null; sources: { name: string }[]; album?: string | null };
const tagsOf = (s: { genres: string | null }) => new Set((s.genres ?? "").toLowerCase().split(/,\s*/).filter(Boolean));
const shares = (a: Set<string>, b: Set<string>) => [...a].some((t) => b.has(t));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((t) => b.has(t)).length;
const mainArtist = (s: { artists: string }) => s.artists.split(", ")[0]!.trim();
const albumKey = (s: { album?: string | null; artists: string }) => (s.album ? `${mainArtist(s)}|${s.album.toLowerCase()}` : "");

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

/** Vibe variety caps. */
export const VIBE_SAME_ARTIST_MAX = 2;
export const VIBE_PER_ARTIST_MAX = 2;
export const VIBE_PER_ALBUM_MAX = 1;
export const VIBE_RECENT_WINDOW = 3;

export type VibeContext<T> = {
  /** Main artists of the last songs (newest last). */
  recentArtists?: string[];
  /** Songs played through this session — tags are scored against all of them. */
  liked?: T[];
};

/**
 * Vibe shortlist (25): ≤2 by the current artist (0 if heard in the last 3 songs),
 * 10 same genre (≤2 per artist, 1 per album), 7 same playlist mood, 6 wildcards (new artists first).
 * Everything is ranked by shared genre + mood tags with the current and played-through songs.
 * Empty slots roll into the next group. `pool` should already be shuffled.
 */
export function vibeShortlist<T extends ShortSong>(
  current: T | undefined,
  pool: T[],
  moodTags: (s: T) => Set<string>,
  ctx: VibeContext<T> = {},
): T[] {
  const seen = new Set<string>(current ? [current.spotify_id] : []);
  if (!current) return take(pool, 25, seen);
  const artist = mainArtist(current);
  const recent = new Set((ctx.recentArtists ?? []).slice(-VIBE_RECENT_WINDOW));
  const refs = [current, ...(ctx.liked ?? [])];
  const g = new Set(refs.flatMap((r) => [...tagsOf(r)]));
  const mood = new Set(refs.flatMap((r) => [...moodTags(r)]));
  const curG = tagsOf(current);
  const score = (s: T) => overlap(tagsOf(s), g) + overlap(moodTags(s), mood);
  const ranked = [...pool].sort((a, b) => score(b) - score(a));

  const perArtist = new Map<string, number>();
  const perAlbum = new Map<string, number>();
  const out: T[] = [];
  let carry = 0;
  const fits = (s: T) => {
    const a = mainArtist(s);
    if ((perArtist.get(a) ?? 0) >= VIBE_PER_ARTIST_MAX) return false;
    const k = albumKey(s);
    return !k || (perAlbum.get(k) ?? 0) < VIBE_PER_ALBUM_MAX;
  };
  const group = (list: T[], n: number) => {
    const want = n + carry;
    let got = 0;
    for (const s of list) {
      if (got >= want) break;
      if (seen.has(s.spotify_id) || !fits(s)) continue;
      seen.add(s.spotify_id);
      const a = mainArtist(s);
      perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
      const k = albumKey(s);
      if (k) perAlbum.set(k, (perAlbum.get(k) ?? 0) + 1);
      out.push(s);
      got++;
    }
    carry = want - got;
  };

  const artistCap = recent.has(artist) ? 0 : VIBE_SAME_ARTIST_MAX;
  if (artistCap) {
    const byArtist = pool.filter((s) => mainArtist(s) === artist).sort((a, b) => overlap(tagsOf(b), curG) - overlap(tagsOf(a), curG));
    const before = out.length;
    group(byArtist, artistCap);
    carry = artistCap - (out.length - before);
  }
  const others = ranked.filter((s) => mainArtist(s) !== artist && !recent.has(mainArtist(s)));
  const sameGenre = g.size ? others.filter((s) => overlap(tagsOf(s), g) >= Math.min(2, g.size)) : [];
  group(sameGenre, 10 + (artistCap ? 0 : VIBE_SAME_ARTIST_MAX));
  const sameMood = mood.size ? others.filter((s) => shares(moodTags(s), mood)) : [];
  group(sameMood, 7);
  const wild = others.filter((s) => shares(tagsOf(s), g) || shares(moodTags(s), mood));
  const fresh = wild.filter((s) => !(ctx.recentArtists ?? []).includes(mainArtist(s)));
  group([...fresh, ...wild], 6);
  if (carry) group(others.length ? others : ranked.filter((s) => mainArtist(s) !== artist), 0);
  if (out.length < 25) out.push(...take(ranked, 25 - out.length, seen));
  return out.slice(0, 25);
}

/** True when a Vibe pick repeats an artist from the last 3 songs, or the album of the last song. */
export function violatesVariety(
  pick: { artists: string; album?: string | null },
  recent: { artists: string; album?: string | null }[],
): boolean {
  const last = recent.slice(-VIBE_RECENT_WINDOW);
  if (last.some((r) => mainArtist(r) === mainArtist(pick))) return true;
  const prev = recent[recent.length - 1];
  return !!prev && !!albumKey(pick) && albumKey(prev) === albumKey(pick);
}

/** New angle (15): 10 random songs sharing no genre, tag or artist with the session, 5 forgotten favorites. */
export function newAngleShortlist<T extends ShortSong & Hist>(session: T[], pool: T[], now = Date.now()): T[] {
  const seen = new Set<string>(session.map((s) => s.spotify_id));
  const tags = new Set<string>();
  const artists = new Set<string>();
  for (const s of session) {
    for (const t of tagsOf(s)) tags.add(t);
    for (const a of s.artists.split(", ")) artists.add(a.trim());
  }
  const away = pool.filter((s) => !shares(tagsOf(s), tags) && !s.artists.split(", ").some((a) => artists.has(a.trim())));
  const out = take(away, 10, seen);
  out.push(...take(away.filter((s) => isForgotten(s, now)), 5, seen));
  if (out.length < 15) out.push(...take(pool.filter((s) => isForgotten(s, now)), 15 - out.length, seen));
  if (out.length < 15) out.push(...take(away.length ? away : pool, 15 - out.length, seen));
  return out;
}

/** Studio suggestions — default mix when Crate has no pattern to go on. */
export const ALL_TIME_FAV_MIN = 67; // more than 67 streams ever
export const CURRENT_FAV_MIN = 5; // more than 5 streams...
export const CURRENT_FAV_DAYS = 28; // ...in the last 4 weeks
export const isAllTimeFavorite = (s: Hist) => (s.plays ?? 0) > ALL_TIME_FAV_MIN;
export const isCurrentFavorite = (recentStreams: number) => recentStreams > CURRENT_FAV_MIN;

export type MixSong = Hist & { spotify_id: string; name: string; artists: string };
function shuffled<T>(list: T[], rand: () => number) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
/**
 * 2 all-time favorites, 2 current favorites, 2 forgotten favorites, 2 wildcards — each picked at random.
 * A short group rolls into the next; wildcards fill whatever is left. `recent` = streams in the last 4 weeks by spotify_id.
 */
export function defaultSuggestionMix<T extends MixSong>(
  pool: T[],
  recent: Map<string, number>,
  now = Date.now(),
  rand: () => number = Math.random,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const add = (list: T[], n: number) => {
    let got = 0;
    for (const s of shuffled(list, rand)) {
      if (got >= n) break;
      const keys = [`id:${s.spotify_id}`, `na:${s.name.trim().toLowerCase()}|${s.artists.trim().toLowerCase()}`];
      if (keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      out.push(s);
      got++;
    }
    return n - got;
  };
  let carry = add(pool.filter(isAllTimeFavorite), 2);
  carry = add(pool.filter((s) => isCurrentFavorite(recent.get(s.spotify_id) ?? 0)), 2 + carry);
  carry = add(pool.filter((s) => isForgotten(s, now)), 2 + carry);
  add(pool, 2 + carry);
  return out;
}
