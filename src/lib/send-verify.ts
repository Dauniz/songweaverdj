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

/** The full recovery sequence after an open app ignored Crate's list. Returns whether
 *  Crate's song ended up playing. Steps are injected so the order is testable. */
export async function recoverStuck(target: string, steps: {
  nextUp: () => Promise<string | null>;
  skipForward: () => Promise<boolean>;
  resendExplicit: () => Promise<boolean>;
  check: () => Promise<boolean>;
}): Promise<boolean> {
  const first = stuckRecovery(await steps.nextUp(), target);
  let loaded = false;
  if (first === "next" ? await steps.skipForward() : await steps.resendExplicit()) loaded = await steps.check();
  if (!loaded && first === "resend" && stuckRecovery(await steps.nextUp(), target) === "next" && (await steps.skipForward())) {
    loaded = await steps.check();
  }
  return loaded;
}

/** Body for every "play this list" command. The offset is required: without it Spotify's
 *  desktop app restarts its CURRENT song and lines the list up behind it (verified live). */
export function playListBody(uris: string[], positionMs?: number) {
  return { uris, offset: { position: 0 }, ...(positionMs ? { position_ms: positionMs } : {}) };
}
