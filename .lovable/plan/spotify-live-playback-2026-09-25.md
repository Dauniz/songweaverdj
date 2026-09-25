# Spotify Live Playback

## Goal
Move all listening out of Crate and into Spotify. Pressing play on a song—or receiving a new set of picks—starts that exact track on the user’s active Spotify device, while Crate continues choosing the path.

## User experience
- Remove Crate’s bottom playback bar completely.
- Keep the compact play button on each song card.
- When Spotify is already active, start the selected track there immediately.
- When no Spotify device is available, show a small “Open Spotify” dialog with the current track and a clear **Open Spotify** action.
- Use Spotify’s official track link so the installed app opens when supported, with Spotify Web as the fallback.
- After Spotify becomes available, retry the selected track automatically where the browser permits it, with a manual **Try again** action as a reliable fallback.
- Show a clear message if live control is unavailable because the account is not Premium or Spotify needs reconnecting.

## Playback and radio behavior
- Replace the embedded Spotify player with Spotify Connect playback commands.
- Keep Crate’s existing one-song-at-a-time path engine, prefetching, steering, skip learning, and listening history.
- Read Spotify’s current playback state to detect track changes and completion, then send Crate’s chosen next track to Spotify.
- Keep all playback controls in Spotify; Crate will no longer show pause, progress, next, replay, or close controls.
- Demo tracks remain browseable but cannot start Spotify live playback because they do not carry real Spotify track IDs.

## Spotify permissions
- Add Spotify’s playback-reading and playback-control permissions to the existing Spotify login.
- Existing connected users will be prompted once to reconnect so Spotify can grant the new permissions.
- Playback tokens remain server-side; the browser receives only playback status and user-safe error states.

## Technical details
- Add authenticated server functions for active-device lookup, play-track, and current-playback reads using the existing encrypted Spotify connection and refresh flow.
- Return typed states such as `playing`, `no_device`, `premium_required`, and `reconnect_required` rather than exposing Spotify errors.
- Update the radio context to drive Spotify playback and monitor the active track without rendering an in-app player.
- Add a compact Spotify-opening dialog using the existing design system.
- Remove `RadioPlayer` from the studio and delete obsolete iframe/audio playback code.
- Update the project architecture note and verify the card-play, prompt-auto-play, no-device handoff, reconnect, desktop, and mobile flows.

## Platform limitation
A website cannot reliably detect whether the native Spotify app is installed. The official `open.spotify.com/track/...` link provides the dependable handoff: it opens the app when the operating system supports it and otherwise opens Spotify Web. Spotify live playback control requires Spotify Premium.
