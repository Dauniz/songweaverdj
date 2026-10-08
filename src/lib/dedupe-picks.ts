// A song counts once: same Spotify track, or same title by the same artist.
export type PickLike = { spotify_id?: string | null; name?: string | null; artists?: string | null };

export const pickKeys = (t: PickLike): string[] => {
  const keys: string[] = [];
  if (t.spotify_id) keys.push(`id:${t.spotify_id}`);
  if (t.name) keys.push(`na:${t.name.trim().toLowerCase()}|${(t.artists ?? "").trim().toLowerCase()}`);
  return keys;
};

/** Keeps the first of each song; also drops anything matching `exclude`. */
export function dedupePicks<T extends PickLike>(list: T[], exclude: PickLike[] = []): T[] {
  const seen = new Set(exclude.flatMap(pickKeys));
  const out: T[] = [];
  for (const t of list) {
    const k = pickKeys(t);
    if (k.some((x) => seen.has(x))) continue;
    k.forEach((x) => seen.add(x));
    out.push(t);
  }
  return out;
}
