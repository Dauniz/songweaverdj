# Simpler session start: connect on entry, start by prompt or search

## What changes for the user

1. **No more "Start session" button.** A session starts only when you send a prompt or pick a song from the search bar. The header keeps an **End session** button while a session is live.
2. **Songweaver connects to Spotify when you open Studio.**
   - First-time users: onboarding runs as usual (sync library, and so on). When it ends, a card appears: "Connect Crate to Spotify so it can follow what you play". It has **Connect** and **Not now** buttons.
   - Returning users: Songweaver checks for Spotify quietly on entry. The card only appears if Spotify isn't linked or can't be reached.
3. **Playing a song in the Spotify app starts a session by itself.** Once connected, Songweaver checks every few seconds. If Spotify starts playing while no session is running, Crate starts a session from that song, just like picking it in search. Nothing is sent to Spotify until you skip or the song ends.
4. **Fixed: a searched song flashing "Currently playing" and then disappearing.** The song now stays on screen while Crate gets its skip songs ready. It changes only once Spotify is really playing it.

## Onboarding order
```text
Open Studio -> onboarding (first time only) -> sync library -> "Connect to Spotify" card
            -> connected: Crate watches Spotify; a prompt, a search or pressing play in Spotify starts the session
```
The onboarding step that points at "Start session" becomes a step about starting from the prompt or search bar.

## Technical details
- **Bug, step 1: confirm the cause first.** This hasn't been confirmed yet. Reproduce it with Playwright and the Spotify log panel: search for a song, then watch the radio state. The suspected cause is in `radio-context.tsx`. The poll effect (around line 1183) starts as soon as `sessionLive` is true, while the start effect (around line 804) can wait up to about 16 s for the skip songs before it sends anything. During that wait, Spotify reports the old song, a paused song or no device. That can trigger a reroot, the "no device" path, or `stopRadio`, which resets `radio` to IDLE and makes the song disappear.
- **Fix:** add a `startingFor` ref that is set while the first send is pending. The poll ignores observations until that send is acknowledged, or until about 20 s have passed. Idle, no-device and reroot handling never fire during a pending start. The same guard covers the `rerootTo` search path in the middle of a session.
- **Remove** the Start session popover from `SessionControl.tsx` and keep only End session. Move "Resume last session" and "Sync new songs first" into the Spotify library panel.
- **Watcher:** a lightweight `playbackFn` poll every 5 s while Studio is open, the tab is visible and no session is live. It adopts the playing track through the existing seed/adopt logic in `startSession`, refactored into a shared `adoptPlaying()` helper. The 90 s end-session rule still applies only to live sessions.
- **Connect card:** a new `SpotifyConnectPrompt` shown after `OnboardingTour` completes, or on entry when `getSpotifyStatus` shows no connection. It reuses `usePreparedSpotifyUrl`/`openSpotifyAuth` so it stays iOS-safe. "Not now" is remembered per user for the rest of the visit.
- **Update** the `OnboardingTour` session step and `AGENTS.md` (session start rule).
