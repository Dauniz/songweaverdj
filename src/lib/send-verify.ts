/** After a checked send: did Crate's song load, is Spotify closed, or is it open but
 *  ignoring the song (it kept playing its own)? Only "closed" may show the Open Spotify popup. */
export function sendVerifyOutcome(loaded: boolean, openWithOwnSong: boolean): "playing" | "not_switched" | "no_device" {
  if (loaded) return "playing";
  return openWithOwnSong ? "not_switched" : "no_device";
}

/** Spotify's desktop app sometimes takes Crate's list but restarts its own song instead of
 *  switching. If Crate's song already sits first in "next up", a plain skip lands on it
 *  (no restart); otherwise re-send the list naming Crate's song explicitly. */
export function stuckRecovery(queueFirst: string | null | undefined, target: string): "next" | "resend" {
  return queueFirst && queueFirst === target ? "next" : "resend";
}
