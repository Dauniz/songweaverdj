# Fix: song 2 of the prompt playlist replays over and over

## What happened
Your log shows "Slide" marked as finished three times in a row: at 15:12:51, 15:13:31 and 15:13:42. It came right after "Love$ick" (song 1). Each time Slide ended, Crate handed over to... Slide again.

The cause is that Slide was in your playlist twice. When the next playlist song is the same as the playing one, Crate never moves forward in the list. Every finish lines up the same song again, and the skip song never gets its turn. Spotify ended up with only that one song, so it looped.

The fix from a moment ago (no repeated songs among the 6 picks) removes the duplicate. That session started before the fix, though. These steps make sure it can never loop again, even if a duplicate slips in some other way.

## What changes for you
- Crate never picks the playing song as its own finish song. If the playlist's next song is the same as the current one, he skips past it to the following pick. If none is left, he goes back to the maze.
- If a hand-over would line up the same song again, Crate picks a fresh finish song instead and logs "Skipped a repeat in your playlist".
- The finish song always goes to Spotify together with its skip song, so Spotify can never get stuck on a single song.

## Technical details
- `radio-context.tsx` `queuedNext`: return the first later pick whose `spotify_id` (and name|artists) differs from the current song, and move `idx` forward past matching entries.
- The playlist-advance effect: when the current id equals `list[idx]` and `list[idx+1]` is the same song, collapse the duplicates instead of returning early forever.
- `handOver`: if `finishB.track.spotify_id === cur.spotify_id`, drop it and fall back to `branches.played` or a fresh `fetchBranch` that excludes `cur`. Never send `[cur]` alone. If `skipB` is still null, use C or a fresh scout, so the list always has 2 songs.
- Check: replay the logic with a 6-pick list that contains a duplicate. Add a small unit test for the "next distinct pick" helper. Typecheck.
