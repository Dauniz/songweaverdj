# Queue several songs in a row

## What you'll see
- Queue a song from search: one branch goes down to it (as today).
- Queue another: a second branch grows below the first song, then a third below that, and so on. A straight chain of "Queued" cards, in the order you added them.
- When a queued song starts, it glides up to the top, the chain moves up one step.
- When the chain is empty, the normal two-door tree comes back and Crate picks songs as usual.

## How it plays
- Playing song = A, first queued = B, second queued = C, etc.
- While A plays, Spotify's "next up" holds B. Finish or skip A: B plays.
- The moment B starts, Crate sends C to Spotify's "next up". When C starts, it sends D. Same push Crate already does for doors, so no extra sound glitch.
- The last queued song gets normal Crate doors (finish + skip) planned behind it while it plays, so the maze takes over smoothly after it.
- Skipping a queued song moves to the next queued song (the skip never jumps out of your queue). It still counts as a skip for Crate's learning.
- Spotify's own queue is never touched, as today.
- Steering with a song (search Play, chat pick, prompt) or a New Angle reset clears the queue, since you asked for something new. Starting a song yourself in Spotify also clears it.
- Queuing the same song twice is ignored.

## Technical details
- `radio-context.tsx`: replace the single `queued` ref with a list `userQueue` (ref + state for the UI), exposed in context. `queueTrack` appends; if it's the first item it runs today's path (becomes B + skip redirect). On a song change where the new current is `userQueue[0]`, shift it off; if more remain, the next item becomes B and the skip door, sent as `[current, next]` via the existing door push (pattern like the prompt playlist's `queuedNext`). If none remain, normal B/v/C/w planning runs. Skip redirect (poll + `skipNow`) uses `userQueue[0]`. Steer/reroot/foreign pick/session end clear the list. Door checks never replace a queued song.
- `PathMaze.tsx` (`JunctionTree`): when the queue has items, draw a vertical chain: O → card 1 → card 2 …, each with a single primary-colored branch, growing with the existing pathLength animation; promotion uses the existing "center" glide, and the rest of the chain slides up one level. Tree height grows with the list (cap visible cards at ~5 with a "+N more" note).
- `src/components/crate/AGENTS.md`: update the search "Queue" rule to the multi-song queue.
- Add a small test for the queue order rule (shift on start, next pushed, empty → normal).
- Real Spotify playback can't be tested here; you'll need to verify it live.
