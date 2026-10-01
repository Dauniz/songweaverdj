# Crate double-checks his upcoming songs during each song

## Goal
While a song plays, Crate regularly checks that every song he needs next is picked. If one is missing, he picks it right away instead of finding out at the last second.

For the current song A, the songs he needs are:

```text
A
├─ finish → B ─ skip → v   (v must be ready before A ends)
└─ skip   → C               (C is already waiting in Spotify)
```

## What the code shows
- **A real gap:** when Crate's finish pick turns out to be the same song as the skip pick, he picks a new finish song. In that case the new finish song's own "if you skip" song (v) is thrown away and never picked again. This matches what you saw.
- **Failed picks stay empty:** if picking v (or B or C) fails or times out, nothing tries again. Crate only notices at the hand-over, about 3 seconds before the end, and then rushes a pick or falls back.

## The fix
1. **Fix the gap:** when the finish song is picked again, Crate also picks its skip song (v) again.
2. **Check every 10 seconds during a song** (only while music is playing and no hand-over or cool-down is running):
   - Is the finish song (B) picked?
   - Is B's skip song (v) picked, and is it different from B, A and C?
   - Is the skip song (C) known and lined up behind A in Spotify?
   - If any are missing, Crate picks only the missing one, without redoing the others or changing songs already on screen.
3. **Last-chance check about 25 seconds before the end:** the same check, so v is ready well before the hand-over.
4. **Never mid-song sends:** the check only prepares picks. Nothing is sent to Spotify mid-song, except when C is missing from Spotify's next up entirely (the existing "never leave next up empty" rule).
5. **Log:** each repair writes a "PLAN REPAIRED: picked missing v/B/C" line to the admin Spotify log, so we can see how often it happens.

Picks, roads, prompts and the tree stay the same.

## Technical details
- `radio-context.tsx` scouting effect (around line 482): the re-choose branch rebuilds `finishSkip` from the new `again` promise, so the key no longer drops it.
- Store resolved values next to the promises (`playedVal`, `skippedVal`, `finishSkipVal`) so a quick check doesn't have to await.
- New `useEffect` interval (10 s, plus one at `durationMs - 25_000`) guarded by `sessionLive`, `!swapping.current`, `!calming`, matching `branches.current.key` and the current generation. Missing or failed parts are re-fetched with `fetchBranch` using the same exclusions. Results are written only if the key and generation still match.
- Use a single-flight flag so repairs never overlap with each other or with the hand-over.
- `handOver` keeps its current fallbacks but will now usually find v ready.
- Verify with mocked branches: (a) the finish re-pick path gets v; (b) a v fetch that fails is repaired on the next check; (c) a stale key never writes.
