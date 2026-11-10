/** Songbook replay: how often a saved song comes back as the finish door. */
export type PoolHistoryItem = { spotifyId: string };

export const RECENT_WINDOW = 50;

/** Songs between Songbook picks: 4–6, stable for a given song. */
export function songbookGap(currentId: string | null | undefined): number {
  let h = 0;
  for (const c of currentId ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 4 + (h % 3);
}

/**
 * Next saved song for the finish door, or null when it isn't time yet.
 * Never two Songbook songs in a row, never a song heard in the last 50.
 */
export function pickSongbookTrack<T extends { spotify_id?: string | null }>(
  pool: T[],
  history: PoolHistoryItem[],
  gap: number,
  exclude: (string | null | undefined)[] = [],
): T | null {
  if (!pool.length) return null;
  const poolIds = new Set(pool.map((t) => t.spotify_id).filter(Boolean) as string[]);
  let last = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (poolIds.has(history[i]!.spotifyId)) { last = i; break; }
  }
  const since = history.length - 1 - last;
  if (since < gap) return null;
  const recent = new Set(history.slice(-RECENT_WINDOW).map((h) => h.spotifyId));
  const ex = new Set(exclude.filter(Boolean) as string[]);
  return pool.find((t) => t.spotify_id && !recent.has(t.spotify_id) && !ex.has(t.spotify_id)) ?? null;
}
