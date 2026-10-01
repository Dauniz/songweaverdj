# Alternative roads fully replace Vibe/Era

## What I found
- **Song picking is mostly correct.** When Wormhole, Texture, Scene or Deep cuts is on, Crate picks from that road's own ~15-song shortlist and follows that road's rule. The Era Road code and the "era hop" hint are skipped.
- **The labels are wrong.** Crate still runs the default skip ladder (Vibe, then Era, then New Angle) in the background and puts that road on every door. That is why Wormhole shows "Vibe" and "Era" tags.
- **The backup songs ignore the road's rules.** The backup songs Crate lines up in Spotify behind a skip door come from the road's own songs, but they are ranked by Vibe/Era closeness.
- **Running out falls back without warning.** If a road has no songs left for a door, Crate quietly goes back to a Vibe/Era pick, still labeled Vibe/Era.
- **Small leftovers in the AI instructions.** It still says "live signals (… road, side road …)" and "Played through (the road that works)", which mixes default-road ideas into alternative-road picks.

## Changes
1. **One road label per door while an alternative road is on.** Every door, "You are here", the maze tree and Door debug show the road's name with its current step, for example "Wormhole", "Texture · piano", "Deep cuts · 2014" or "Scene · Robyn". Vibe Road, Era Road and New Angle never show while it is on.
2. **Turn off the default ladder while an alternative road is on.** Skips still count, because Texture, Deep cuts and Scene need them. Crate stops switching between Vibe, Era and New Angle, and stops the era-hop step. When you turn the road off, the default ladder starts fresh from your next song.
3. **Backup songs follow the road.** They come from the same shortlist rules as the doors, with no Vibe/Era ranking.
4. **Clear fallback.** If the road truly has no fitting songs left, the door shows "Wormhole (none left)" (or that road's name) and the console logs it. It no longer pretends to be a Vibe/Era pick.
5. **Cleaner AI instructions on alternative roads.** Only that road's rule, your history, memories and skips are sent. The default-road wording is dropped.
6. **Door checks use the road's rules.** Artist cooling, songs already heard and repeat checks stay the same. The only change is that "would this door belong on its road" now uses the alternative road's step, not the default ladder.

## Verify per road
- Wormhole: every door says Wormhole, every pick is a song you keep returning to, and skips don't change the label.
- Texture: 1 skip keeps the texture, and every 2nd skip changes it. The label shows the texture.
- Deep cuts: 1 skip stays in the same era, and every 2nd skip changes era. The label shows the year.
- Scene: 0 skips = the original artist's web, 1 = back to the artist, 2–3 = a featured artist, 4+ = "Scene · new angle".
- Turning the road off goes back to Vibe/Era from the next song.
- I'll check this with a small script that runs the server logic for each road. I'll also confirm the labels in Door debug, but only during a live session, because the test browser can't play Spotify.

## Technical details
- `path.functions.ts`: when `alt` is set, return `road: "alt"` plus `roadLabel: alt.label`, and skip `buildShortlist` in `pathReserves`. Use `planAltRoad`/`altPool` there instead. Strip default-road wording from the system and live prompt when `alt` is set.
- `radio-context.tsx`: add `"alt"` to `Road` (with a stored label). In `advance()`, keep the road `"alt"` while a lens or deep cuts is on (only increment `consecutiveSkips`, `eraShift=false`). Clear `ladderStart` and `baseRoad` when the road turns off. `doorProblem` treats `"alt"` as road-valid.
- `PathMaze.tsx` / `DoorDebug.tsx`: `roadName()` shows the stored label for `"alt"`. The skip-road preview uses the server label.
- Update `src/components/crate/AGENTS.md` (alternative roads rule) to say they own the road label and suspend the default ladder.
