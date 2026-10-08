# Your own Spotify pick mid-song counts as a skip

## What changes
Today, when you start a song yourself in Spotify mid-session, Crate throws the maze away and starts over from that song. Instead:

1. **It counts as a skip.** Your song takes the place of the skip door (C) in the maze, the skip counter goes up by one, and the usual skip ladder (same road / other road / New Angle) keeps going from there.
2. **w goes in right away.** Crate instantly sends [your song, w] to Spotify — your song keeps playing where it is, and w (the skip door Crate had already lined up behind C) sits in "next up". No waiting on a new pick, so no sound glitch.
3. **Then business as usual.** Crate picks a new finish door (B) and skip-of-finish (v) for your song in the background, like after any skip.
4. **Big direction change = a hint.** If your song is clearly far from where the maze is heading (different scene/era/mood), Crate treats it like a steer: it saves a short steer note ("you jumped to X — lean that way") and re-plans B and v around it. C/w stay as sent. The maze log says e.g. "Your pick in Spotify — steering toward X". A close match just continues the normal maze, no steer.

Unchanged: songs Crate queued itself (C, B, prompt picks), finish hand-overs, the start guard, and the hand-over lock (a pick arriving mid hand-over is held and applied after, as today).

## Technical details
- radio-context.tsx poll branch (~1809, the "foreign" `acceptObserved(..., true)` path): replace the reroot with a new `takeForeignAsSkip(track, state)`:
  - build history entry as a skip of current (outcome "skipped"), set current = foreign track, keep `upSkip`'s planned `finishSkip` (w) as the new skip door;
  - `startSpotifyPlayback(foreign, true, w, state.progressMs, "foreign skip", …)` using the fast path (no restart if Spotify already plays it — queue-only push if supported, else position-aimed push from the live progress);
  - if no w is ready yet, push w as soon as it resolves (same path as the existing upSkip push).
- Divergence check: one cheap gemini-3.6-flash call (new small server fn in path.functions.ts, `judgeForeignPick`) given the last ~5 maze songs + current road/steer note + the foreign song; returns `{ far: boolean, note }`. Skipped if the song shares an artist with recent maze songs. If `far`, call `steerSession(note, { keepQueue: true, keepW: true, source: "spotify" })` so B and v are re-scouted while C/w stay queued.
- Ends a running prompt playlist (as any skip does).
- AGENTS.md (crate): add one rule for "foreign mid-song pick = skip + instant w push, far picks steer".
