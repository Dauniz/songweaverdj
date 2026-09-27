# Simplify Spotify skipping to one safe branch

## Goal
Replace the fragile three-skip buffer with one visible, authoritative “if you skip” song. Correct synchronization takes priority over supporting repeated rapid skips.

## New behavior
```text
Current song → one “if you skip” song
            ↘ one “if you finish” song
```

- Spotify receives only `[current, if-you-skip]` during normal playback.
- Songweaver displays exactly that same skip song, and only updates the display after Spotify accepts the list.
- If the listener skips once, Spotify lands on the known skip song.
- Crate waits for one quiet second, then chooses that song’s new finish and skip branches.
- If the listener skips again before the quiet second and new pair are ready, Spotify is paused at the next observed status update and the existing “Cool your jets” warning appears.
- While paused, Crate rebuilds from the last confirmed song. Playback resumes only after Spotify has accepted the fresh two-song list.
- A song played to completion keeps the existing smooth handover: Spotify receives `[if-you-finish, that song’s if-you-skip]` together, with no second refresh one second later.

## Synchronization safeguards
- Give every Spotify list a generation number. Ignore scouting results, replies, and observations belonging to an older generation.
- Allow only one playback-list update at a time.
- Abort old scouting immediately after a skip, manual Spotify selection, cooldown, or session restart.
- Treat the current Spotify song plus the accepted generation as the source of truth; never let an unfinished Crate result overwrite the screen.
- Keep the admin live log, adding the generation and reason to each send so mismatches are visible.

## Simplification
Remove the skip-2/skip-3 lineup, multi-position jump accounting, resume-from-skip-3 behavior, and four-skip burst threshold. Retain manual-queue warnings and manual song rerouting.

## Important trade-off
Spotify does not send instant skip events. The pause after a second rapid skip can happen only when Songweaver’s next poll sees it, normally within 0.8–1 second. The simpler state machine prevents stale URI lists from being accepted during that delay.

## Verification
- Start from search and from a vibe; confirm one Spotify SEND containing current + displayed skip.
- Skip once, wait one second, and confirm one fresh accepted generation whose skip matches the screen.
- Skip twice rapidly; confirm Spotify pauses, the warning appears, stale searches never send, and playback resumes with a matching two-song list.
- Let a song finish; confirm one handover SEND and no follow-up resend.
- Pick a different song manually in Spotify; confirm Crate reroots without a skip loop.
