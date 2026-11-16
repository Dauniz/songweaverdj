/** Spotify sometimes plays a regional copy of a song under a different ID (seen live:
 *  Snooze 3WYe… came back as 51fZ…, with no linked_from). Map such a report back to the
 *  ID Crate sent, matched by name + first artist among songs Crate recently sent. */
export type SentSong = { id: string; name: string; artists: string };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const firstArtist = (s: string) => norm(s.split(",")[0] ?? "");

export function resolveSentId(reported: { id: string | null; name: string; artists: string }, sent: SentSong[]): string | null {
  if (!reported.id) return reported.id;
  if (sent.some((s) => s.id === reported.id)) return reported.id;
  const n = norm(reported.name);
  const a = firstArtist(reported.artists);
  if (!n) return reported.id;
  const hit = sent.find((s) => norm(s.name) === n && firstArtist(s.artists) === a);
  return hit ? hit.id : reported.id;
}
