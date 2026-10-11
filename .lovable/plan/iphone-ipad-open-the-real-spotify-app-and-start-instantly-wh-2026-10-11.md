# iPhone/iPad: open the real Spotify app, and start instantly when it's already open

## Why you land in Spotify Web today
1. **Fallback fires too eagerly.** After tapping "Open Spotify", Crate waits 1.5 s and, if the page is still visible, opens Spotify Web. iOS shows its "Open in Spotify?" question *while the page is still visible*, so the fallback races it and wins.
2. **Automatic open without a tap.** The phone/tablet auto-open we tested runs without a finger press. iOS silently ignores app links outside a tap, so only the web fallback goes through.
3. **Inside the Lovable editor** the preview sits in a frame, and iOS blocks app links from frames completely. There the button can only ever open Spotify Web. This is an Apple limit, not something Crate can work around.

## What changes (iPhone and iPad)
- **"Open Spotify" opens only the app.** The tap sends iOS straight to the Spotify app, so you get Apple's "Open in Spotify?" prompt (or a direct switch if you've allowed it before). No automatic Spotify Web fallback.
- **Small "Use Spotify Web instead" link** appears in the popup for people without the app — only used when you tap it.
- **No auto-open on phones/tablets.** The popup stays, since iOS needs a real tap. Desktop auto-open stays as is.
- **In the editor preview:** the popup says app opening works on the published site, and offers Spotify Web there. Real app testing happens on songweaverdj.lovable.app.

## Already open → start instantly
- When a session starts, Crate first checks which Spotify devices are open (as today) and, if one is, starts playing on it with no popup.
- **New: the moment you come back from Spotify** to Songweaver, Crate checks again right away (not after the next 3 s poll) and starts the song on the found device.
- While the popup is showing, Crate keeps checking every ~2 s; if Spotify shows up, the popup closes by itself and music starts.

## Limit worth knowing
iOS removes a paused Spotify app from Spotify's device list after a few minutes in the background. Then Crate truly can't reach it and the popup is correct; one tap to Spotify fixes it.

## Technical details
- `radio-context.tsx` `openSpotify`: Apple branch, top-level → `window.location.href = "spotify:"` only; delete the 1.5 s `x-safari-https` / `window.open(webUrl)` fallback. Framed → no scheme attempt; set issue flag `framed` so the dialog shows the editor note + web link.
- Auto-open effect: return early for touch devices (keep desktop).
- `SpotifyOpenDialog`: add optional "Use Spotify Web instead" link (`window.open("https://open.spotify.com/", "_blank")` inside the tap) and framed-preview note.
- `visibilitychange` → visible while `awaitingSpotify` or `playbackIssue?.status === "no_device"`: immediately call `findOpenSpotify`, then `startSpotifyPlayback` (or adopt playing) and clear the issue. Shorten the popup's background check to ~2 s.
- Verify in Playwright with an iPad user agent: tap triggers only a `spotify:` navigation (no `open.spotify.com`), web link opens only on its own tap, and a mocked open device on return closes the popup and sends play. Real app hand-off must be tested on your iPad on the published site.
