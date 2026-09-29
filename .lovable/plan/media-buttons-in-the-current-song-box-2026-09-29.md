# Media buttons in the current song box

## What will change
- The "You are here" box (node O in the maze) gets two media buttons where the Feedbacker card sits today:
  - **Pause/Play toggle** — pauses Spotify while a song plays; switches to a play button to resume.
  - **Next song** — acts exactly like the user pressing next in Spotify: the skip door plays and Crate rebuilds the path, with no new decision logic.
- The Feedbacker moves from its full-width card to a small notebook icon in the top-right corner of the "You are here" box. Clicking it opens the same note input as before.

## What stays the same
- All Crate mechanics: queue rules, skip detection, branch planning, cooldowns, 90 s pause rule (pausing from the button is treated exactly like pausing in Spotify).
- The Feedbacker behavior and how notes are saved to Walrus Memory.

## Technical details
- `src/lib/spotify.functions.ts`: add two small server functions next to `pauseSpotifyPlayback`:
  - `nextSpotifyTrack` — POST `https://api.spotify.com/v1/me/player/next`.
  - `resumeSpotifyPlayback` — PUT `/me/player/play` with no body (resume where paused).
- `src/components/crate/PathMaze.tsx`:
  - `SongNote` keeps its state and `data-onboarding="feedbacker"` attribute (the onboarding tour clicks this element) but renders as a compact corner icon button instead of a card.
  - New media button row at the bottom of node O: Play/Pause (toggles on `musicPlaying` from `useRadio`) and Skip-forward, using the existing ghost icon-button styling and tooltips. Buttons are disabled when there is no live session, Spotify is idle, or Crate is calming down.
  - Next/pause calls go through the existing server functions; the poll loop already detects the resulting track change, so no radio-context changes are needed.
- Verify the box layout at iPhone, tablet and desktop widths, and confirm the build is healthy.
