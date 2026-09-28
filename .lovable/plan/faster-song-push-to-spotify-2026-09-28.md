# Faster song push to Spotify

## Why it takes 1000+ ms today
Every time Crate sends a song list, the server runs these steps one after another before answering:

1. Looks up your Spotify sign-in in the database (and sometimes renews it)
2. Asks Spotify for your list of devices (~150–300 ms)
3. Sends the play command
4. Turns off repeat and shuffle, and waits for Spotify to answer (~150 ms)
5. Waits 250 ms, then asks Spotify "are you playing it?" and retries after another 450 / 700 ms if not
6. Reads your Spotify queue to check for songs you queued yourself (~150 ms)

Only step 3 actually changes the music. The rest is checking.

## What we'll change
- **Remember your device.** Reuse the device from the last successful send. Only ask Spotify for the device list if that device stops working.
- **Remember your sign-in** for a few minutes on the server instead of reading it from the database every time.
- **Repeat/shuffle off only once per session**, not on every send, and without waiting for Spotify's answer.
- **Answer as soon as Spotify accepts the play command.** The "is it really playing?" check moves to Songweaver's normal once-a-second Spotify check, which already notices stale or wrong songs.
- **Queue check runs separately** after the send, so the "clear your queue" warning still appears, just a moment later.
- **Log the time** of each step in the admin log so we can see the real gain.

Expected result: about 200–400 ms from send to Spotify switching songs, mostly Spotify's own response time.

## Trade-off
If Spotify accepts the command but a sleeping device never starts playing, Songweaver finds out on its next check (up to ~1 s later) instead of before answering. The fixes for Lukas' "false skip" problems stay in place, since the start guard already waits for the right song before listening.

## Technical details
- `src/lib/spotify.functions.ts`:
  - Module-level `Map<userId, {token, expiresAt}>` and `Map<userId, deviceId>` in `spotifyAccess` / `playSpotifyTrack`; on play 404, clear the cached device, fetch `/devices`, retry once.
  - Add `initDevice?: boolean` input; repeat/shuffle only when true (first send of a session), fire-and-forget.
  - Return `{status:"playing", deviceName}` right after a 2xx play; drop the verify loop.
  - New `getForeignQueueCount` server function holding the queue logic.
- `src/components/crate/radio-context.tsx`: pass `initDevice` on session start, call the queue check after a send, and confirm playback through the existing poll (`startingFor` guard, 25 s window) instead of the server loop.
- `src/lib/spotify-log.ts`: record the send→ack time.
