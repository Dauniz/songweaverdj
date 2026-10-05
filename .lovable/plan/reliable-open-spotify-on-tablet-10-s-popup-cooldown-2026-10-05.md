# Reliable "Open Spotify" on tablet + 10 s popup cooldown

## What's wrong today
- Tapping "Open Spotify" first tries the `spotify:` app link through a hidden frame, then waits 2.5 s and opens Spotify Web. On iPhone/iPad, Safari blocks that delayed web tab (it's no longer inside the tap), and the hidden-frame app link is often ignored inside the Lovable preview. Result: sometimes nothing opens.
- After tapping, the popup closes and only comes back if you press play again — there's no "try again" if Crate still can't see Spotify.

## What changes
1. **iPhone / iPad:** the tap opens `https://open.spotify.com/` directly, right inside the tap. iOS hands that link to the Spotify app when it's installed; otherwise it opens Spotify Web in a new tab. No delayed second attempt, so nothing gets blocked.
2. **Desktop / Android:** keep the app-first attempt, but open the web fallback tab within the tap only when the app link can't be used (Android uses an intent link with a web fallback built in). No delayed `window.open`.
3. **10 s cooldown:** after tapping "Open Spotify" the popup hides for 10 s while Crate keeps checking for Spotify (every ~2–3 s). If Spotify connects, the popup stays gone and the session continues. If not, the popup comes back after 10 s — and repeats the same cycle each time it's tapped. Tapping "Not now" keeps today's behaviour (no automatic return).
4. The existing "give up after the grace period" rule for ending a session stays as is.

## Verification
- Playwright at tablet size (820×1180, iPad user agent): confirm the tap triggers exactly one open of `open.spotify.com` inside the tap, the popup hides, and reappears after 10 s when no device appears; and stays hidden when a mocked "ready" state arrives.
- Real app-vs-web handoff on a physical iPad can't be tested from here — you'll need to try it with and without the Spotify app installed.

## Technical details
- `radio-context.tsx` `openSpotify`: branch on `isAppleTouchDevice()` → synchronous `window.open("https://open.spotify.com/", "_blank")` (fallback `location.assign` if null and not framed). Android: `intent://open#Intent;scheme=spotify;package=com.spotify.music;S.browser_fallback_url=https%3A%2F%2Fopen.spotify.com%2F;end`. Desktop: keep `spotify:` attempt; drop the 2.5 s `window.open`.
- Add `reopenTimer` ref: on open, store the issue, `setPlaybackIssue(null)`, start 10 s timer; on fire, if no successful `startSpotifyPlayback`/adopt since, restore the issue. Clear the timer whenever playback succeeds, the session ends, or the user dismisses.
- Keep the existing retry loop, capped to the cooldown window per cycle.
