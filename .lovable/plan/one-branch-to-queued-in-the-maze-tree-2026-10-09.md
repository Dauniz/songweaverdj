# One branch to "Queued" in the maze tree

When a song is queued from search, both maze doors hold the same song (tagged "Queued"), so the tree draws two branches down to two copies of the same card. This change is visual only: while a song is queued, the tree shows **one** branch going straight down to a **single, centered** "Queued" door. No mechanics, picking, or Spotify logic changes.

## Detection

In `JunctionTree` (src/components/crate/PathMaze.tsx), a layout flag:

- `const queued = shown.upNext?.altRoad === "Queued"` — the queue feature tags both doors with the same track (`altRoad: "Queued"`, set in `queueTrack` in radio-context.tsx), so checking the finish door is enough.

## Layout when queued

- **Branch:** one curve from the current song (O) straight down (tx = w/2) using the existing `branch()` helper, in `var(--primary)`. The second branch is not rendered.
- **Door:** a single door card, horizontally centered (`left: (w - doorW) / 2`), reusing the existing `Door` component with:
  - label "Queued", sublabel "if you finish or skip"
  - the queued track (title, artists, cover)
  - the road tag already reads "Queued" via `roadName` (the track's `altRoad`), so no change needed there.
- `dH` measurement already takes the max of both door refs; the measurement effect will use the single door's ref (left ref) so the tree height stays correct.

## Animation

- **Growth:** the single branch grows with the existing animation (pathLength 0 → 1, door fades in) — unchanged behaviour.
- **Promotion (queued song starts playing):** the promote detection currently maps to "left"/"right". Add a third origin: if the new current song is the queued door's track, the travelling clone starts from the centered door position (x = (w − doorW)/2, y = doorsTop) and glides up to O's position, same timings as today. The clone keeps using the queued track's cover/title.
- **Reset animation** (New Angle, search-start, new prompt): unchanged.
- `prefers-reduced-motion` collapses to the existing short fade — unchanged.

## Robustness

- When no song is queued (normal play state), the tree renders exactly as today — two branches, two doors.
- If the queued door is missing a track, the existing dim/`Finding…` states apply.
- No changes to `radio-context.tsx`, `LibrarySearch.tsx`, door labels elsewhere, or any playback/queue logic.

## Verification

- Typecheck + build green.
- Visual check in Studio with a live session: queue a song from search → tree collapses to one centered branch with a single "Queued" door; let it play or skip → door glides up and the tree returns to the normal two-branch layout.
- Real Spotify behaviour verified by you, as usual.
