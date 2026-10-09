/** Multi-song search queue: an ordered list of songs the listener queued. */
export type QueueItem = { spotify_id?: string | null };

/** When `currentId` starts playing and it is the head of the queue, drop it. Returns the new list
 *  (same array if nothing changed). */
export function advanceUserQueue<T extends QueueItem>(list: T[], currentId: string | null | undefined): T[] {
  if (!currentId || !list.length || list[0]?.spotify_id !== currentId) return list;
  return list.slice(1);
}

/** Append a song unless it's already queued or is the playing song. */
export function addToUserQueue<T extends QueueItem>(list: T[], track: T, currentId: string | null | undefined): T[] {
  if (!track.spotify_id || track.spotify_id === currentId || list.some((t) => t.spotify_id === track.spotify_id)) return list;
  return [...list, track];
}

/** Doors while a queue runs: finish and skip both go to the head; the head's own skip/finish
 *  (v) is the next queued song, or null when the maze takes over after it. */
export function queueDoors<T extends QueueItem>(list: T[]): { door: T | null; after: T | null } {
  return { door: list[0] ?? null, after: list[1] ?? null };
}
