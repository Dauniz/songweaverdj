# Connect straight to an already-open Spotify app (tablet, iPhone and desktop)

All rules below apply the same on every device: tablet, iPhone and desktop.


## What happens today
When a session starts, Crate only treats Spotify as "on" if a song is **actively playing**. If the Spotify app is open but paused (or just sitting on its home screen), Crate shows the "Open Spotify" popup anyway. Tapping it then bounces you out to Spotify or a browser tab, even though the app was already open. That's the odd behaviour.

The rule exists because Spotify keeps reporting your last paused song even after the app is closed, so a paused song alone doesn't prove the app is open.

## The fix
When any session starts (Start button, prompt, search, resume, welcome card), Crate first asks Spotify which of your devices are **open right now**. Spotify's device list only includes apps that are actually open and reachable, so it's a reliable answer.

**Start session button:**
- **Spotify playing:** the song keeps playing in Songweaver and becomes "You are here".
- **App open but paused:** no popup. Crate presses play on the paused song and builds from it. If nothing is loaded, it plays Crate's first pick.
- **Same door rules as always:** Crate picks the finish song, the skip song and their skip songs right away, and pushes his skip song into Spotify's next up as soon as it's ready, with the song continuing from where it is. As today, that push can cause one brief sound glitch on a song that was already playing.

**Prompt, search or welcome card:**
- **App open (playing or paused):** no popup. Crate ignores whatever Spotify was playing and starts his own maze from your input.
- **Skip door sent with the first song:** Crate waits until both his first song and its skip door are picked, then sends them to that device in one go. The skip door is lined up from the start, so nothing needs pushing mid-song and there's no sound glitch. The other doors (finish song and the skip songs behind them) follow the usual rules.

**Either way:**
- **No open device:** the "Open Spotify" popup appears as it does today, with the 10 s cooldown and background checks.
- **Resume last session:** continues Crate's saved maze on the open device.

The pill dot turns green as soon as the open app is found.

## Limits worth knowing
iOS drops a paused Spotify app from the device list after a few minutes in the background. In that case Spotify really can't take commands, so the popup is still correct, and opening the app once fixes it.

## Technical details
- `spotify.functions.ts`: new `getSpotifyDevices` server fn (authed) returning `{ status, devices: {id,name,isActive}[] }` from `/me/player/devices`, ignoring restricted devices.
- `radio-context.tsx` `startSession` (~1978): after the `isPlaying` check fails, call devices. If one exists: when the playback state has a `spotifyId`, resume it via `startSpotifyPlayback` with that track at `progressMs` and `adoptPlaying`; otherwise leave the session live and let the first pick start playback. Set `spotifyAlive = true` and skip `setPlaybackIssue`.
- Prompt/search/resume paths: before showing a no-device popup, run the same devices check; `startSpotifyPlayback`'s existing `pickDevice` + wake transfer already handles inactive devices.
- Use the same check in the waiting loop (~1955) so a newly opened but idle app also ends the wait.
- Verify with mocked responses: playing → adopt; devices + paused → no popup, resume sent; no devices → popup.
