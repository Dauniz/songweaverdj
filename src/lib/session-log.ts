/** Session log: one row per listening session, kept small and pruned. */
export const LOG_KEEP = 100;
/** A session needs at least this many played-through songs to show up in the log. */
export const LOG_MIN_PLAYED = 1;

export function sessionTitle(seedPrompt: string, firstSong: string): string {
  const p = seedPrompt.trim();
  if (p) return `“${p.length > 70 ? `${p.slice(0, 69)}…` : p}”`;
  return firstSong ? `Started from ${firstSong}` : "Listening session";
}

export function sessionLength(startedAt: string, updatedAt: string): string {
  const min = Math.max(1, Math.round((Date.parse(updatedAt) - Date.parse(startedAt)) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Ids beyond the newest LOG_KEEP rows (rows sorted newest first). */
export function idsToPrune(rowsNewestFirst: { id: string }[], keep = LOG_KEEP): string[] {
  return rowsNewestFirst.slice(keep).map((r) => r.id);
}
