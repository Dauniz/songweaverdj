# Spontaneous search plays continue the maze mid-session

## Current behavior (verified in code)

`LibrarySearch.play()` always calls `startRadio([track], "")` (src/components/crate/LibrarySearch.tsx). `startRadio` (src/components/crate/radio-context.tsx) resets everything: history trail, road, steering chips, consecutive skips, skipped-artist memory, played list, and mints a new session ID. So a spontaneous search play mid-session wipes the pre-maze path.

Meanwhile, picking a song inside the Spotify app mid-session goes through `acceptObserved(..., reroot: true)`, which keeps history, chips and artist memory, re-roots the path from the new song, and continues.

## Goal

Searching and playing a song mid-session should behave like picking it in Spotify: the maze remembers everything before the song and continues from it, with the spontaneous song as the new anchor influencing the next picks. With no session running, search-play still starts a fresh session as today.

## Changes

1. **src/components/crate/radio-context.tsx** — add `rerootTo(track: CardTrack)`:
   - If the radio is not active: delegate to `startRadio([track], "")` (current behavior).
   - If active: keep `history`, `chips`, `road`, `consecutiveSkips`, `sessionId`, `seedPrompt`, `artistSkips`, `played`, and the session; set `current` and `seed` to the searched song; clear the branch prefetches (`branches.current = null`) and `queued`; do NOT set `noPlayFor` (we initiated the play, so the existing play effect should start it in Spotify); log a `steer` listening event for the new song so Walrus learns it was a deliberate choice.
   - Expose `rerootTo` on the context value.

2. **src/components/crate/LibrarySearch.tsx** — `play(row)` calls `rerootTo(track)` instead of `startRadio`.

3. Keep the Spotify-open dialog and polling flows untouched: setting `current` already triggers `startSpotifyPlayback`, and the 4s poll guards against the transition (it only reacts when the previously observed song differs from the new current).

## Verification

- Typecheck + build clean.
- Playwright (with injected session): start a session from a search result, let the Maze show "You are here", then search and play a second song — confirm the trail history is preserved (pre-maze songs still listed), "You are here" switches to the second song, the doors re-prefetch, and the session stays live (End session button still shown).
- Also verify search-play with no active session still starts a fresh session.
