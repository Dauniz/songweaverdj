# Fix: maze resets right after a finish hand-over

## What the logs show

Listening log, session at 19:18 (Stockholm):

```text
19:18:04.77  play_through  Love Survive   <- A finished, hand-over to B ("The Feeling") sent
19:18:04.97  early_skip    The Feeling    <- 0.2 s later B counted as a SKIP
19:18:06.29  early_skip    Love Survive   <- 1.3 s later A counted as a SKIP too
```

Spotify itself never wavered: every status check afterwards shows "The Feeling" playing steadily from 0:28 on. The same three-line pattern (finish, then two instant "skips") also appears three times in the 2 Oct session, so this is a recurring bug, not a one-off.

## Root cause

1. The finish hand-over sends [B, v] to Spotify and moves Crate onto B straight away, marking B as "already seen playing".
2. The very next status check still reports Love Survive. Either the request left before the hand-over and came back after it, or Spotify hadn't switched yet. Spotify often lags about a second after a play command.
3. Crate compares that with B. Love Survive isn't in the new line-up [B, v], so Crate reads it as "you picked a song in Spotify". It logs B as a skip, starts the maze over from Love Survive and clears the line-up.
4. The next check reports The Feeling. That isn't in the now-empty line-up either, so Crate takes it as another manual pick. It logs Love Survive as a skip and starts the maze over from The Feeling. That's why brand-new B, v, C and w appeared, and why the v sent with the hand-over was thrown away and replaced by a fresh skip-door push.

The detailed Spotify debug log only lives in the browser, so the exact send can't be replayed. But the listening log and the status checks match this sequence exactly.

## Fix

1. **Ignore outdated status checks.** Each check remembers when it was sent. If Crate changed songs (hand-over, skip, landing, resume, start) while the check was in flight, its answer is thrown away.
2. **Grace window after a hand-over.** Until Spotify actually reports B (or about 5 s pass), a report of the song that just finished means "Spotify hasn't switched yet". Crate waits and does nothing. It never counts that as a skip or a manual pick.
3. **B isn't "seen playing" until Spotify confirms it.** After the hand-over, B starts as "not yet observed". So no song change can count as a skip off B until Spotify has really shown B playing. The existing rescue that re-sends when Spotify jumps past B onto v keeps working.
4. **No double finish entries.** One song can be logged as played-through only once per turn. The 4 Oct log shows "Lissabon" and "100 m" each recorded twice, 14 ms apart.

What stays the same: real manual picks in Spotify still restart the maze from your song. Real skips off B still go to v. C is still never swapped mid-song.

## Technical details

All changes are in `src/components/crate/radio-context.tsx`:

- `transitionSeq` ref, bumped wherever `lastTransition.current` is set (handOver, acceptObserved, landOnFrontier, finish recover, cooldown resume, session start/adopt). In the poll `check()`, capture the seq before `await playbackFn()` and `return` if it changed (keep the `observeSpotify` log call).
- In `handOver`, after a successful send, set `lastPlayback.current.observed = false` (was `true`).
- In the `handoverGuard` block: if `!hg.finishSeen`, `state.spotifyId === previous finished song id` (store `from: cur` on the guard) and `Date.now() - hg.sentAt < 5_000`, return early without touching `lastPlayback`.
- A guard on `log(…, "play_through")` keyed by `sessionId + spotify_id + turn`, so handOver and LATE FINISH can't both log the same finish.
- Add one rule line to `src/components/crate/AGENTS.md`: poll answers sent before a song change are discarded, and the finished song reported during the hand-over grace window is never a skip.

Verification: typecheck/build. Real Spotify playback can't be run here, so the user confirms on the tablet by letting a song finish and checking that B plays with v kept and no "MANUAL" line in Door debug.
