# iOS/iPad background-limitation popup

## Goal
When a user on iPhone or iPad opens the Studio, show a short popup explaining that Songweaver isn't optimal on their device while it runs through the Lovable preview: iOS suspends browser tabs in the background, so a live session requires the app/tab to stay active and visible at all times.

## Design
- Reuse the existing `AlertDialog` component, same pattern as `SpotifyOpenDialog.tsx`.
- Device detection: reuse the iOS check already in `src/lib/spotify-open.ts` (`/iPad|iPhone|iPod/.test(navigator.userAgent)` plus the `MacIntel` + `maxTouchPoints > 1` fallback that catches iPads reporting as Mac). Extract it into a small shared helper (e.g. `isAppleTouchDevice()` in `src/lib/spotify-open.ts` or a tiny new util) so both call sites use one function.
- Show the popup once per device: store a flag in `localStorage` (e.g. `ios-background-notice-dismissed`). Dismissing with "Got it" never shows it again on that device; do not nag on every visit.
- Read the localStorage flag inside `useEffect` (hydration-safe; no SSR mismatch).

## Copy (title + body)
- Title: "A heads-up for iPhone & iPad"
- Body: Songweaver isn't fully optimized on your device. While the app runs through the Lovable preview, iOS suspends browser tabs in the background — so a session only stays alive while Songweaver is open and active on your screen. Keep the tab in the foreground for the whole session; once Songweaver is published to its own URL/domain this limitation goes away.
- Single button: "Got it"

## Changes
1. `src/lib/spotify-open.ts` — export the existing iOS detection as a reusable helper (no behavior change to auth opening).
2. New `src/components/crate/IosBackgroundNotice.tsx` — AlertDialog with the copy above, gated on device detection + localStorage flag.
3. `src/routes/_authenticated/studio.tsx` — render `<IosBackgroundNotice />` once inside `Studio` (outside session logic; purely informational, touches no Crate mechanics).

## Non-goals
- No changes to session, radio, queue, or Spotify logic.
- No popup on desktop or Android.

## Verification
- `bunx tsgo --noEmit` clean; build OK in build-errors.log.
- Playwright with injected session: emulate iPhone user agent → popup appears on Studio, "Got it" dismisses it and it stays dismissed after reload; desktop user agent → no popup.
