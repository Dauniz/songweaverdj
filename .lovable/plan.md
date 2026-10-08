# Alternative roads steer, they don't reset

## What changes
Turning an alternative road on or off (Wormhole, Texture, Scene, Deep cuts) now works like any other steer:

- **The playing song and its skip song (C) stay exactly as they are** — nothing new is pushed to Spotify mid-song, so no glitch.
- Crate switches to the new road's rules and re-picks the **finish door (B)**, B's skip song (**v**) and C's own skip song (**w**) under the new road. They enter Spotify the normal way when the song ends or you skip.
- The maze log says "Alternative road X on → steering the doors ahead" (or "off → back to the default roads").
- The 1.2 s misclick buffer and the 10 s "toggle back keeps the old doors" stay as today.

## Road tags
Tags follow the actual songs, not the switch:
- The current song keeps its tag ("Vibe road", "Era road", ...) until it ends.
- C keeps its old tag (it was picked under the old road).
- The new B (and later w/v and every song picked while the road is on) shows the alt road's name.
- After turning the road off, songs picked under it keep the alt tag until they've passed; new picks show Vibe/Era/New angle again.

## Technical details
- radio-context.tsx `applySideRoad` timer body: replace the full clear (branches/preSkip/landingPlan/upSkip reset + setRadio) with `steerSession` in a new road mode: `steerSession("", undefined, { source: "road" })` path that keeps C (pre) exactly, drops the landing plan so w is re-planned, re-scouts B and v with the new lens/deepCuts refs, and does not set a steer note or save a steer insight. Respects the existing hand-over lock (pendingSteer).
- Per-song tag: stamp `altRoad?: string` (lens name / "Deep cuts", or undefined) on each track when its branch is fetched (fetchBranch / landing plan / reserves). `useRoadName` in PathMaze.tsx becomes `roadName(road, track)` and uses `track.altRoad` instead of the global lens; "You are here" uses the current song's stamp.
- Saved live sessions keep the stamp (it's on the track object).
- AGENTS.md (crate): update the alternative-roads rule — toggling steers B/v/w, C stays; tags are per-song.
