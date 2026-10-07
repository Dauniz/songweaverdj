# Fix: session live + green dot, but no song or maze

## What's going wrong
When a session starts and Crate finds the Spotify app open but doesn't see a song **playing** at that exact moment (iOS often reports "paused" for a second or two after the app is woken), Crate turns the dot green and waits quietly. Three gaps can then leave you stuck:

1. **The quiet wait can die.** After 90 s of waiting, Crate stops watching, but the session stays "live" and the dot stays green. From then on nothing checks Spotify, so pressing play in Spotify never shows up.
2. **The green dot lies.** It turns green just because the app was found, not because Crate is actually following a song.
3. **Strict "playing" check.** Crate only adopts a song if Spotify says it's playing *and* reports a song ID. A paused-but-loaded song in an open app, or a brief report without the song ID, is ignored instead of retried.

## The fix
- **Never a dead session:** while the session is live and no song is being followed, Crate keeps checking Spotify every ~3 s (and instantly when you come back to the tab) for as long as the session lasts. The 90 s rule only ends the session if Spotify is truly gone, and then it ends it properly (button returns to "Start session", dot grey).
- **Adopt what's playing, whenever it appears:** the moment Spotify reports a playing song, it becomes "You are here" and the maze builds with the usual door rules (finish song, skip song, skip door pushed into next up).
- **Open app with a paused song (Start button):** Crate presses play on it, then re-checks a few times over ~5 s; if it's loaded but still paused, Crate adopts it anyway and the maze appears.
- **Honest dot:** green only once Crate is following a song (or actively hearing Spotify play); while waiting it shows the wait state, not green.
- A small note in the memory tab while waiting: "Waiting for Spotify to play…" so it's never just empty.

Same on tablet, iPhone and desktop. I can't test with a real Spotify app here, so you'll need to try it on your tablet.

## Technical details
- `radio-context.tsx` waiting loop (~1950–1993): remove the `setAwaitingSpotify(false); stopRadio({keepSpotify:true})` dead-end; on grace expiry with no open device call `endSession()`; with an open device keep polling. Add a fallback effect: `sessionLive && !radio.active && !playbackIssue` → keep `awaitingSpotify` true.
- Tick: if `state.status==="ready" && state.spotifyId` and (`isPlaying` or start-button resume was sent ≥5 s ago) → `adoptPlaying`. Retry once when `spotifyId` is null.
- `startSession`: extend post-resume checks to ~5 s; adopt paused-but-loaded song from the Start button path only (prompt/search/welcome unchanged).
- `setSpotifyAlive(true)` moved from the findOpen branch to adoption / a confirmed playing poll; LibraryPanel status unaffected otherwise.
- Add console + Spotify-log lines for each wait tick outcome so the next report shows exactly where it stalled.
- Update `src/components/crate/AGENTS.md` session-start rule.
