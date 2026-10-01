# Faster, rarer Spotify pushes

Goal: remove the noticeable sound glitch when a door opens at 0:00. Only how and when Crate sends songs to Spotify changes. Door choices, roads and the maze stay the same.

## Why it's slow today
Each push makes several network trips one after another:
1. Before a "skip rebuild", Crate asks Spotify where the song is (one full trip) just to pick the restart point.
2. Then it calls Crate's server, which looks up your Spotify login, and often the device too. The server's memory of your device is often empty, so it asks Spotify for your devices again (one more trip).
3. Only then does it send the play command.
All of that adds up to 1000+ ms, and the song re-buffers from a stale position.

## What changes
1. **Skip the push when Spotify already has the right line-up.** When you skip and land on C, Spotify already has w queued behind it, because Crate sent [A, C, w] earlier. Crate now sees that and sends nothing. No push means no glitch. This is the most common case.
2. **No position lookup before a push.** Crate already checks Spotify every 0.5–2 s. It uses that last reading plus the time since, so the separate "where are you" trip is gone.
3. **Send the device along.** The browser already knows your active Spotify device from those checks. It passes the device to the server, so the server never has to ask Spotify for your devices on the fast path. The "wake a sleeping desktop" step stays as a fallback only.
4. **Keep the login ready.** The server's saved Spotify login is kept warm, so a push never waits on a login lookup or refresh.
5. **Timing in the log.** Each push logs its total time and the time Spotify took, so we can see the real numbers in your next session.

## Expected result
- Skips that land on a door already lined up: no push at all.
- Pushes that are still needed (a song you started in Spotify, a re-picked door): one trip from the server to Spotify, roughly 200–400 ms instead of 1000+ ms. The short re-buffer itself is Spotify's and can't be removed completely.

## Technical details
- `radio-context.tsx` skip-rebuild effect: return early when `lineup.current` holds `[cur, skip.spotify_id]` back to back and `acceptedGeneration` is current; log "Line-up already correct — no resend".
- Remove the `await playbackFn()` before resend. Position = `lastPlayback.progressMs + (now - lastPlayback.at) + measured one-way latency`, where latency is an EMA of push timings.
- Track `deviceId` from `getSpotifyPlayback` (already returned as `body.device.id`; expose it) and pass `deviceId` to `playSpotifyTrack`. Server: use it directly; on 404, fall back to `pickDevice` (transfer wake stays there).
- `spotifyAccess`: refresh the token proactively when it's within 5 min of expiry during polls, so the push path never refreshes.
- `playSpotifyTrack` returns `spotifyMs`; the client logs `total ms / spotify ms` on the send entry.
- No changes to door selection, `handOver` timing (3 s before end), or queue rules in AGENTS.md beyond noting rule 1.
