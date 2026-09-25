# Spotify-style radio player

## What will change
- Restyle the selected bottom player as a faithful Spotify-inspired desktop playback bar.
- Use a three-zone layout: track artwork/details on the left, playback controls and progress in the center, radio path/steering controls on the right.
- Replace the current control styling with Spotify-like monochrome icon buttons and a prominent circular play/pause control.
- Keep Crate’s unique information—current path, reason, up next, active steering chips—visible but visually secondary.
- Adapt the layout for smaller screens without removing playback or skip controls.

## What stays the same
- Existing playback, replay, skip, stop, keyboard shortcuts, path switching, and steering behavior.
- The embedded Spotify playback connection and all listening feedback logic.

## Technical details
- Update the player and steering popup presentation only.
- Add reusable semantic player colors to the existing design tokens rather than hardcoding colors in the player.
- Use existing app controls and icons, with accessible labels and tooltips.
- Verify the selected player at desktop and mobile widths and confirm the current build remains healthy.
