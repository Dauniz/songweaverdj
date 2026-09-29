# Fix: finish pick gets skipped at the hand-over

## What the logs show
Your session at 14:50 (UTC) recorded this within ~1.5 seconds:

```text
14:50:27.2  song ends -> Crate sends [Days Passed Me By, ACOUSCOUS]   (finish pick + its skip door)
14:50:27.9  Days Passed Me By  -> logged as "skipped"
14:50:28.8  ACOUSCOUS now playing
```

So Crate did push the finish song shown on screen ("Days Passed Me By", very likely the yellow cover). Spotify then jumped straight past it to the second song in the list, ACOUSCOUS (the finish song's own "if you skip" door), and Crate treated that as you skipping.

It is not a one-off. The same pattern appears at 14:46 (Weekend Millionaires skipped instantly, Hello Miss Johnson played) and three times in your earlier session today (12:21, 12:26, 12:27).

## Cause
Crate sends the new pair about 1 second before the old song ends. When the old song finishes in Spotify right as the new list arrives, Spotify treats that ending as "go to next" on the new list, so the first song is passed over. Crate's watcher then sees the second song and logs a skip, and the maze moves on down the wrong branch.

## Fix
1. **Send earlier.** Start the finish hand-over about 3 seconds before the end instead of about 1 second. Spotify's "song ended, go to next" can then no longer overlap with the new list. The last seconds are almost always fade-out.
2. **Check that it landed.** For about 4 seconds after a hand-over, Crate checks what Spotify is playing. If Spotify is on the skip door instead of the finish song, Crate sends [finish song, skip door] again once. You may hear a very short jump, then the right song plays.
3. **No false skips.** While that check window is open, a jump onto the skip door is not logged as a skip, does not count toward New Angle or artist skips, and does not re-plan the maze.
4. **Log it.** When the check has to fix a hand-over, write a "FINISH RECOVERED" line to the admin Spotify log, so it's easy to see if this still happens.

Everything else stays the same: recommendations, roads, and the doors shown in the tree.

## Technical details
- `src/components/crate/radio-context.tsx` `handOver`: change the final send offset from `end - 1_100` to about `end - 3_000`. Record `handoverGuard = { finishId, skipId, until: now + 4_000, generation }`.
- Poll loop: while `handoverGuard` is active and Spotify reports `skipId`, return early without `log(..., "early_skip")`/`next("skipped")`, and call `startSpotifyPlayback(finish, true, skip, …, "finish recover")` once. Clear the guard when Spotify reports `finishId` or when it expires.
- Also check the late-finish path (`handOver(0)`) so it can't double-send while the guard is active.
- Verify: go through the 14:50 sequence with a mocked playback state and confirm exactly one recovery send and no skip events.
