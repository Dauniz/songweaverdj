# Fix: song finishes while the tablet tab is away, Crate plays the skip song

## What the log shows
- 16:45 Sicily: played through. 16:49 Holdin' On: played through. No skip was recorded.
- So Crate knew Holdin' On finished, but Spotify ended up on "In the morning", the skip song, instead of the finish song "Running through 2 am".

## Cause (yes, it's the tab)
- iPad pauses Songweaver while the tab is hidden. Crate sends the finish pair about 3 s before a song ends, but a paused tab can't send anything.
- With nothing sent, Spotify just plays the next song in its own list: Crate's skip song.
- Crate already has a "late finish" rescue for this case: if the old song was nearly over and Spotify landed on the skip song, it sends the finish pair. But when you come back to the tab, Crate first refreshes its "last seen" snapshot with the new song. That wipes out the memory that the old song was nearly done, so the rescue never fires and the skip song keeps playing.

## Fix
1. When you return to the tab, Crate checks before refreshing anything: was the old song near its end (or should it have ended during the time away), and is Spotify now on Crate's lined-up skip song? If yes, that was a finish, so Crate sends "Running through 2 am" (plus its skip song) right away, like a normal finish.
2. Same check when Spotify is already a little way into the skip song (up to about 20 s in). Past that, Crate leaves the skip song alone so it doesn't cut a song you're already into, and continues the maze from it.
3. The rescue counts as a finish, not a skip, so your skip history stays clean.
4. It writes a "LATE FINISH (tab was away)" line to the admin Spotify log.

The trade-off: you'll hear a second or two of the skip song before the finish song takes over. Without a running tab there's no way to send earlier.

## Technical details
- `radio-context.tsx` visibility handler (~line 1863): read `lastPlayback.current` before overwriting it. Late finish when `previous.spotifyId === current.spotify_id`, the state is on `lineup.current` (not the current song), and either `previous.ratio >= 0.9` or `previous.progressMs + away >= previous.durationMs - 3_000`. With `state.progressMs < 20_000`, call `handOver(0)` and skip the snapshot overwrite. Otherwise treat it as landing on the skip door without a skip event.
- Clear `swapping`/`handoverGuard` before calling so nothing old blocks it.
- Verify with mocked playback: hidden at 3:30/3:45, back on the skip door at 0:05 → one finish-pair send, no skip event; back at 0:40 → no send.
