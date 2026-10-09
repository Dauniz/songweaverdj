# Steering skips now, plus a "Queue" option for search

## What changes for you

**1. Steering = skip now (default)**
- Picking a song in search mid-session: it starts right away. The playing song counts as a skip.
- Sending a steer prompt in chat, or starting a prompt playlist mid-session: Crate's first pick starts right away. The playing song counts as a skip.
- To avoid the sound glitch, Crate sends [your pick, its skip door] together, the same way a fresh session starts. Then it plans the finish door (B), v and w as usual.
- The skip counter goes up by one, so the skip ladder keeps working.

**2. Queue (new, search only)**
- Each search result gets a small "Queue" button next to Play.
- A queued song becomes **both** doors for the playing song. Finish it or skip it, the queued song plays next.
- In the Maze, its door shows the tag **"Queued"** instead of "Vibe road" etc.
- Nothing goes into Spotify's own queue. Crate only uses the "next up" slot it already controls.
- About the skip side: Spotify's next-up slot already holds the old skip door (C). Crate does not swap it while the song plays, because that causes the glitch. Pressing Next in Songweaver plays the queued song. If you skip inside the Spotify app, Crate catches the change and switches to the queued song at once. You may hear the old C for a split second.
- After the queued song starts, the maze continues from it.

**3. Late steers**
- A steer in the last ~10 s of a song is still held and applied after the hand-over, like today. A "skip now" steer then just plays the new pick as the next song.

## Open question
- Should the chat say "Steering skips the current song" so people know? By default, the live-session text changes to: "Steering the session will make Crate skip to the desired track."

## Technical details
- `radio-context.tsx`
  - `rerootTo` mid-session: new mode `"skip"` (default) that runs the fresh-start pair path (pick C for the new song, then `startSpotifyPlayback(pick, …, C)`, with A alone after 6 s) and records a skip history entry for the current song. Uses the start guard so stale polls are ignored.
  - `steerSession` from chat or a prompt: if picks exist, play `picks[0]` the same way. For a prompt playlist, `promptQueue` starts from pick 2. With a note and no picks, keep today's re-scout behaviour.
  - New `queueTrack(track)`: sets B = track and the skip door (logical C) = track, tagged `altRoad: "queued"`. The Spotify queue is not touched. `skipNow` plays the logical C. The foreign-pick handler treats Spotify playing the *old* C as a skip toward the queued song and plays it directly. w and v are re-planned from the queued song.
  - The hand-over lock still applies.
- `LibrarySearch.tsx`: Queue button per row (live session only); Play keeps the skip behaviour.
- `PathMaze.tsx` / door labels: show "Queued" for `altRoad === "queued"`.
- `MoodChat.tsx`: live-session text update.
- `src/components/crate/AGENTS.md`: replace the "mid-session search/prompt never replace the playing song" rule with the skip-now and queue rules.
- Checks: typecheck, plus a test for the skip and queue door logic. Real Spotify behaviour needs your test.
