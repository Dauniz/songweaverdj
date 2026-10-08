# Mid-session search and prompts change the finish door, not the current song

## What changes for you
- **Search mid-session:** picking a song no longer cuts off the song that's playing. The chosen song becomes the "If you finish" door (B). Crate then picks a new "skip after B" song (v) that follows the chosen song's direction.
- **Prompt mid-session** (a new prompt, or pressing play on one of the prompt cards while a session is live): same thing. The current song keeps playing. The prompt's first pick becomes B, and v follows that direction.
- The "If you skip" door (C) stays exactly as it is, because it's already lined up in Spotify. Changing it would cause the sound glitch.
- Nothing extra is sent to Spotify straight away. B and v are only sent when the current song finishes, as usual.
- With no session running, search and prompts still start a new session the way they do now.

```text
Before:  search/prompt -> current song replaced, whole maze rebuilt
After:   A keeps playing
         ├─ finish -> chosen song (new B) ─ skip -> new v (chosen song's direction)
         └─ skip   -> C unchanged (already in Spotify) ─ skip -> w
```

## Open choice (default below)
- A prompt mid-session will still use its 6 picks as a playlist, starting from B: finish B and pick 2 plays, and so on. A skip goes back to the normal maze. Searching a song doesn't start a playlist.

## Technical details
- `radio-context.tsx`: `rerootTo` mid-session uses the existing `steerSession` path with the searched song as the steer pick and no steer note. v is scouted from the state "B finished" (so it uses B's direction). C, w and the Spotify queue are left alone. A "steer" listening event is still logged so Walrus learns from the choice.
- `startOrReplan` mid-session: sets `promptQueue` to the picks (from the chosen card), then sets the first pick as B through the same steer path, instead of calling `rerootTo`. `steerSession` gets an option so it doesn't clear `promptQueue` in this case.
- `steerSession` today re-scouts w even when C hasn't changed. For search and prompt it keeps the existing w if one is already planned for C.
- The maze log reads "Your pick is next: "X" plays when this song ends" (instead of "the path continues from here").
- Update the search and steering/prompt rules in `src/components/crate/AGENTS.md`.
- Check: typecheck, then in Playwright (signed in) search mid-session and check that the current song stays the same, B shows the searched song, and v changes.
