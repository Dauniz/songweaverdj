/** After a checked send: did Crate's song load, is Spotify closed, or is it open but
 *  ignoring the song (it kept playing its own)? Only "closed" may show the Open Spotify popup. */
export function sendVerifyOutcome(loaded: boolean, openWithOwnSong: boolean): "playing" | "not_switched" | "no_device" {
  if (loaded) return "playing";
  return openWithOwnSong ? "not_switched" : "no_device";
}
