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
1. **Send earlier.** Crate sends the finish pair about 3 seconds before the end instead of about 1 second. The new song starts right away, so the old song loses about 3 seconds of fade-out. Spotify's "song ended, go to next" can then no longer land on the new list.
2. **Tell Spotify's jump apart from your skip.** The two can be told apart by whether the finish song ever actually played:
   - **Spotify's jump:** the finish song is never seen playing. Spotify goes straight to its skip door within about 1.5 seconds of Crate's send. Only in this case does Crate re-send [finish song, skip door], once.
   - **Your skip:** you can only skip a song that is already playing. Once Spotify has shown the finish song playing, even for a moment, any move to the skip door is yours. Crate handles it as a normal skip and never re-sends, even in the first seconds.
3. **What happens to the skip count (old point 3, reworded).** Only Spotify's jump is kept out of your skip history. Your real skips still count toward New Angle, artist skips and the maze, the same as now.
4. **Skips in the old song's last 3 seconds.** Just before sending, Crate checks Spotify once more (this check already exists). If you've already skipped or picked another song, Crate sends nothing. If you skip after the send, you're skipping the finish song, which is already playing, so it counts as a normal skip.
5. **Log it.** When Crate fixes a jump, it writes a "FINISH RECOVERED" line to the admin Spotify log.

Everything else stays the same: recommendations, roads, and the doors shown in the tree.

## Technical details
- `src/components/crate/radio-context.tsx` `handOver`: change the final send offset from `end - 1_100` to about `end - 3_000`. After a successful send, set `handoverGuard = { finishId, skipId, sentAt, finishSeen: false, recovered: false }`.
- Poll loop: if Spotify reports `finishId`, set `finishSeen = true` (from then on the guard is inactive). If Spotify reports `skipId` while `!finishSeen && !recovered && now - sentAt < 1_500`, skip the `early_skip` log and the re-plan, re-send `[finish, skip]` once (`"finish recover"`), and set `recovered = true`. Any other case goes through the normal skip path.
- The late-finish path (`handOver(0)`) doesn't fire while a recovery is in flight.
- Verify with mocked playback: (a) the 14:50 jump gets one recovery and no skip event; (b) finish song seen, then skip at 1 s, is logged as a normal skip with no re-send; (c) a skip before the send cancels the hand-over.
