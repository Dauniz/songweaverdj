# Crate's session handling: steadier start, faster reactions, clear end

The O/A/B/C line-up stays exactly as it is. This plan only changes how sessions start, how Crate watches Spotify, and how it replans when something unexpected happens.

## What changes for you

**1. Start session button returns.** It sits in the header next to End session. A session and its Spotify connect request start in three ways only:
- clicking **Start session**
- picking a song in the search bar
- sending a prompt when no session is running

Crate no longer watches Spotify quietly in the background when no session is running. The automatic "Connect Crate to Spotify" card on entry goes away. The Connect button in the library panel stays.

**2. Faster detection while a session runs.** Crate checks Spotify about every second, even when the Songweaver tab is in the background, for example while you are in the Spotify app. A song you switch to in Spotify should be picked up within about 1–2 s, and Crate starts building a maze from it right away.

**3. One clear rule for detours.** Every detour replans the same way: the new song becomes "You are here". The trail, skipped artists and side road are kept, old plans are dropped, and new doors are found.
- **New prompt mid-session:** Crate picks the best song from the prompt's list, continues the current session from it, and uses the prompt as the new direction. The session is no longer wiped.
- **Search mid-session:** unchanged behaviour (continue from the song). It uses the same shared path so it can't drift.
- **Song switched in Spotify:** adopted immediately without restarting it (as today), then doors are found.

Late answers from an earlier plan are thrown away, so Crate can't mix up two plans.

**4. Connection check and end rules.**
- If Spotify stops answering or closes, you get the "Open Spotify" message. Crate keeps retrying every few seconds.
- If music is **paused for more than 90 seconds**, or Spotify is gone for 90 seconds, the session ends automatically. Today a pause only ends the session after 30 minutes.

**5. After a session ends,** the header shows two buttons: **Start new session** and **Resume last session**. Resume picks up where Crate was in the maze, with the same trail, road and side road.

```text
No session --[Start / search / prompt]--> connect to Spotify --> live
Live: check every ~1 s -> skip / finish / your own song -> replan from that song
Live: paused or Spotify gone > 90 s -> ended -> [Start new] or [Resume last]
```

## Technical details
- Known causes of slow detection:
  - The live poll returns early when `document.hidden`, so it does nothing while the user is in Spotify.
  - The poll is suspended while `playbackIssue` is set.
  - The `startingFor` guard can block observations for up to 25 s.

  Changes: keep polling when hidden (browsers throttle hidden tabs to about 1 s anyway; only mobile needs the stale-snapshot guard, which becomes "require one fresh read after becoming visible" rather than skipping every read). Clear `startingFor` as soon as the first send is acknowledged, and cut the fallback from 25 s to 8 s.
- `radio-context.tsx`: add a shared `replanFrom(track, { prompt?, reason })` used by `rerootTo`, the mid-session prompt path and `acceptObserved(reroot)`. It bumps `listGeneration`, clears `branches`, `door`, `preSkip` and `landingPlan`, keeps history, `artistSkips`, `played` and the lens, and logs a steer event.
- `startRadio` only runs when no session is active. `MoodChat` calls `replanFrom` with the prompt when one is.
- Remove the idle watcher effect (lines ~1476–1494) and the auto-show logic in `SpotifyConnectPrompt`. `startSession` keeps its 5 quick adopt attempts, then shows "Open Spotify".
- Idle end: replace the 30-minute rule with 90 s (a shared `END_AFTER = 90_000` for both pause and no device).
- `SessionControl.tsx`: live → End session. Not live → Start session, plus Resume last session when a saved session exists.
- Update `AGENTS.md` (session start rule) and the onboarding step that mentions starting a session.
- Verify with Playwright under a signed-in session (button states, prompt replans without a wipe). Real detection speed needs a test with live Spotify playback.
