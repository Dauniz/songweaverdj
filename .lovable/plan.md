# Fix: session start order (C first, then w, then B and v)

## What's wrong now
At a fresh start, the skip door C waits for the finish door B to be picked first, so C never matches B. Only then are A and C sent to Spotify. That adds a full AI pick of delay before anything plays. During that wait, the old Spotify song keeps playing and the start is easier to trip up.

The "plays C, skips A" part isn't confirmed yet. The code shows no reason for it, so step 1 adds log lines to catch it on your next test.

## New start order
```text
1. Pick C (A's skip door)          <- immediately, nothing else first
2. Send [A, C] to Spotify          <- as soon as C is ready
3. Pick w (C's own skip door)      <- right after the send, top priority
4. Pick B (A's finish door)        <- avoids C, in parallel with w
5. Pick v (B's skip door)          <- after B
```
- B is chosen to avoid C (today it's the other way round), so the two still never match.
- A search pick, prompt or welcome card all use this order. Mid-session steering is unchanged.
- If picking C takes too long (~6 s), A is sent alone right away and C is pushed as soon as it's ready, so A starts promptly.

## Catching "skips A"
The maze log gets lines for: the exact pair sent at start, the first song Spotify reports after the send, and any skip Crate detects in the first 10 s of a session, with what triggered it. Your next test will show whether Spotify jumped past A by itself, or whether Crate read something as a skip.

## Technical details
- `src/components/crate/radio-context.tsx`
  - Prefetch (~540–580): for a fresh start (no `pre`, no `plan`, `s.history.length === 0`), build `skippedB` first as `fetchBranch(skippedState, signal, queueRest)` without `Promise.all([playedB, ...])`. Build `playedB` as `skippedB.then(c => fetchBranch(advance(s,"played"), signal, [c?.track.spotify_id, knownSkipId].filter(Boolean)))`, or `qNext` if a playlist pick exists. `finishSkip` stays chained on both.
  - Start effect (~1160–1193): wait on `b.skipped` with a 6 s timeout. On timeout, send A alone and push C via the existing skip-door push once it resolves. `startSpotifyPlayback` already triggers `planLanding` (w) on send, so w starts right after the send, before B finishes.
  - Diagnostics: `pushSpotifyLog` events for the start send, the first report after it, and any skip or reroot within 10 s of session start (with its source branch).
- `src/components/crate/AGENTS.md`: one rule line on start order (C → send [A,C] → w → B → v).
- Verify with `bunx tsgo --noEmit`, then a real test from search.
