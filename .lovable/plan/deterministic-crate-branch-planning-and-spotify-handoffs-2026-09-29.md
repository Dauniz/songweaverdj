# Deterministic Crate branch planning and Spotify handoffs

## Goal
Make every song use one authoritative two-branch plan, so Spotify and the Songweaver tree cannot disagree.

For current song **A**:

```text
A
├─ finish → B ─ skip → v
└─ skip   → C ─ skip → w
```

- When A starts inside the maze, C is already pushed and waiting in Next Up. While A plays, Crate finds B, v, and w.
- Spotify holds A with C as the immediate skip door. Crate keeps B, v, and w ready in memory.
- When A finishes, Crate sends `[B, v]` and promotes B to current.
- When A is skipped, Spotify moves to the already-queued C; Crate immediately sends w behind C, then promotes C to current.

The promoted song gets a new plan immediately:

```text
After finish: B
├─ finish → P ─ skip → u
└─ skip   → v ─ skip → x

After skip: C
├─ finish → G ─ skip → H
└─ skip   → w ─ skip → J
```

Only the pair for the outcome that actually happened is sent to Spotify. The other branch remains prepared but unsent.

### Session entry vs. inside the maze
- **Entry (prompt, search, or a song played directly in Spotify):** no skip door is queued yet, so Crate finds **four** tracks for A: B, C, v, and w. It pushes `[A, C]` as soon as C is ready (for a direct Spotify song, at its current position), then keeps B, v, and w ready.
- **Inside the maze (the normal case):** the new current song's skip door is already waiting in Next Up, so Crate finds only **three** tracks (for example P, u, and x after a finish, or G, H, and J after a skip).

## Implementation

### 1. Replace overlapping queue flags with one authoritative plan
- Introduce a typed plan for the current song containing:
  - current track and plan generation
  - finish door
  - skip door
  - skip door for the finish track
  - skip door for the skip track
  - lifecycle state: planning, ready, handing over, cooling down
- Replace the competing responsibilities currently spread across the landing plan, pre-skip, attempted door, quick-skip, and handover flags.
- Every asynchronous result must match both the current song and plan generation before it can update the tree or Spotify.

### 2. Plan both branches symmetrically
- Start B and C searches together for A.
- As soon as B resolves, start v; as soon as C resolves, start w.
- Keep the existing road rules unchanged:
  - finish doors remain Era Road or Vibe Road
  - New Angle remains eligible only for a skip door after repeated skips
  - existing memory, history, side-road, exclusion, and artist-skip signals remain intact
- Show B and C in the tree as soon as each resolves; precomputed v and w remain internal until their parent becomes current.

### 3. Make Spotify handoffs deterministic
- For a song Crate starts, send `[A, C]` once C is ready; do not send v or w early.
- For a song started directly in Spotify, accept the agreed brief restart glitch: detect A, find C, then promptly replace playback with `[A, C]` at the latest confirmed position.
- On a confirmed natural finish, exclusively commit `[B, v]`.
- On a confirmed skip onto C, exclusively commit `[C, w]`.
- Serialize all Spotify writes through one transition owner so finish handling, skip handling, reconnects, and late planning results cannot overwrite each other.
- Immediately before a finish send, re-read Spotify and cancel if the user has selected another song.

### 4. Correct outcome detection
- Track the expected current song, expected queued skip song, playback progress, and active transition generation together.
- Treat a move to the queued skip door before the natural-end window as a skip.
- Treat a finish only when the current song reaches the verified end window and the finish transition owns the generation.
- Prevent the polling loop from reclassifying a committed finish as a skip or starting a second handoff.

### 5. Handle rapid double-skips safely
- If A skips to C and C skips again before C's full plan is ready:
  - pause Spotify
  - show the existing “Cool your jets” message
  - invalidate A/C’s unfinished plans and writes
  - treat the landed song exactly like a newly detected Spotify song
  - calculate its finish and skip doors, push `[landed song, skip door]`, then resume
- Never reuse an unresolved or stale song from the previous generation.

### 6. Preserve and restore the complete plan
- Save the authoritative current plan with the live session so refresh/resume cannot reconstruct mismatched doors.
- Invalidate it on search, a new prompt, a manual Spotify choice, side-road rewiring, session end, or a newer playback generation.

## Verification
- Add focused state-machine tests for:
  - A finishes → `[B, v]`; then P/u and x are prepared
  - A skips → C, then `[C, w]`; then G/H and J are prepared
  - finish and polling race produces only one Spotify write
  - a late result from an old generation changes neither the tree nor queue
  - rapid A → C → w enters cooldown and rebuilds from w
  - a direct Spotify pick receives its skip door promptly at the preserved position
  - side-road or prompt changes invalidate every descendant plan
- Verify in the preview that the displayed finish/skip doors always match the active plan.
- Run an authenticated Spotify playback check when an active device is available, covering one natural finish, one skip, one rapid double-skip, and one direct Spotify selection.

## Technical note
This is a state-machine refactor inside Crate’s session controller, not a change to its recommendation intelligence. The existing path-selection logic, Walrus memory use, road behavior, prompts, and candidate scoring remain unchanged.
