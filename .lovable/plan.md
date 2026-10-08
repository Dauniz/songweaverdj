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

---

# Skipped songs get a cooldown, never a forever-block

## The problem
Today a skipped song can become a permanent "don't resurface it" memory: the "Don't suggest this again" button, or skipping the same song early twice (ever), writes one to Walrus. Crate reads those memories when picking songs, so the song is in practice gone for good. "Isn't feeling <artist>" memories (3 skips in one session) work the same way. That's what fills the "Songs Crate learned to avoid" list.

## New rules
- **Song cooldown:** skipped early 2+ times within your last 3 sessions → left out for your next 2 sessions, then back in the pool.
- **"Don't suggest this again" button:** same cooldown, 3 sessions.
- **Artist cooldown:** 3+ early skips of one artist in a session → that artist goes to the back of the line (still possible, just less likely) for the next 2 sessions. Never removed completely.
- Nothing is ever blocked forever. A song that's played through again comes off cooldown right away.
- No new permanent Walrus memories for skips. A pattern that keeps showing up across many sessions can still become a normal taste memory ("evenings: modern trap gets skipped"), like today, but that's a hint, not a block.

## Old skip memories
Walrus memories can't be deleted, so Crate stops *using* the old "Skipped … don't resurface" ones: song picking, chat and the welcome guess skip them. They stay stored, just ignored.

## "What Crate knows" page
"Songs Crate learned to avoid" becomes **"Resting for now"**: it shows only songs and artists on cooldown right now, each with "back in N sessions". Old forever-block memories aren't shown there anymore.

## Technical details
- New `src/lib/cooldowns.server.ts`: works the cooldowns out from `listening_events` (session-ordered, `early_skip` / `explicit_skip` / `play_through`) → `{ songs: {name, artists, sessionsLeft}[], artists: {artists, sessionsLeft}[] }`. Unit tests cover the session counts above.
- `radio.functions.ts`: remove the `saveSignalMemory("skipped" …)` and artist-avoid writes. The events are still logged.
- `TrackCard` "Don't suggest" logs an `explicit_skip` event instead of a memory.
- `path.functions.ts` `nextPathTrack` / `pathReserves`: load the cooldowns (cached with the memory bundle) → leave out cooldown songs, add cooldown artists to the coolArtists demotion. Filter recalled/learned memories whose kind is `skipped`, or that start with "Skipped "/"Isn't feeling", out of the prompt. Same filter in chat.server.ts and welcome.functions.ts.
- `crate-knows.functions.ts` + page: replace the avoided list with the cooldown list.
- AGENTS.md (crate): add a cooldown rule, and change "Skip ladder" so it says skips never block permanently.
