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

export type ShortSong = { spotify_id: string; artists: string; genres: string | null; sources: { name: string }[] };
const tagsOf = (s: { genres: string | null }) => new Set((s.genres ?? "").toLowerCase().split(/,\s*/).filter(Boolean));
const shares = (a: Set<string>, b: Set<string>) => [...a].some((t) => b.has(t));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((t) => b.has(t)).length;
const mainArtist = (s: { artists: string }) => s.artists.split(", ")[0]!.trim();

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
 * Vibe shortlist (25): 5 same artist + same vibe, 10 same genre, 5 wildcards sharing a tag,
 * 5 from playlists of the same mood. Empty slots roll into the next group.
 * `pool` should already be shuffled.
 */
export function vibeShortlist<T extends ShortSong>(current: T | undefined, pool: T[], moodTags: (s: T) => Set<string>): T[] {
  const seen = new Set<string>(current ? [current.spotify_id] : []);
  if (!current) return take(pool, 25, seen);
  const g = tagsOf(current);
  const artist = mainArtist(current);
  const mood = moodTags(current);
  const out: T[] = [];
  let carry = 0;
  const group = (list: T[], n: number) => {
    const got = take(list, n + carry, seen);
    carry = n + carry - got.length;
    out.push(...got);
  };
  const byArtist = pool.filter((s) => mainArtist(s) === artist).sort((a, b) => overlap(tagsOf(b), g) - overlap(tagsOf(a), g));
  group(byArtist, 5);
  const others = pool.filter((s) => mainArtist(s) !== artist);
  const sameGenre = g.size ? others.filter((s) => overlap(tagsOf(s), g) >= Math.min(2, g.size)) : [];
  group(sameGenre, 10);
  const wild = g.size ? others.filter((s) => shares(tagsOf(s), g)) : [];
  group(wild, 5);
  const sameMood = mood.size ? others.filter((s) => shares(moodTags(s), mood)) : [];
  group(sameMood, 5);
  if (carry) out.push(...take(others.length ? others : pool, carry, seen));
  return out;
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
