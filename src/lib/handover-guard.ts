// Rules for the moment right after a finish hand-over, kept pure so they can be tested.

/** What to do when Spotify still reports the song that just finished after Crate sent the
 *  finish pair. It is never a skip or your own pick: wait ~4 s, re-send the finish pair once,
 *  wait ~10 s more, then let go (by then a replay is really yours). */
export function staleFinishAction(sinceSentMs: number, resent: boolean): "wait" | "resend" | "release" {
  if (!resent) return sinceSentMs < 4_000 ? "wait" : "resend";
  return sinceSentMs < 10_000 ? "wait" : "release";
}

/** A send never aims at a song's last 3 s: Spotify restarts it from 0:00 or jumps on. */
export function safeSeekMs(positionMs: number | undefined, durationMs: number): number | undefined {
  if (!positionMs || !durationMs || positionMs <= durationMs - 3_000) return positionMs;
  return Math.max(1, durationMs - 3_000);
}
