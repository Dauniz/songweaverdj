# Queued song replaces both doors in Spotify too

## Problem
When you queue a song, Crate marks it as both the finish and skip door, but the old skip song (C) stays in Spotify's "Up next". Crate only redirects a skip while the page is awake, so if you leave the Maze/tab, Spotify plays the old C instead of your queued song.

## What changes
1. **Queueing the first song** pushes it into Spotify right away: Spotify gets [current song (kept at its position), queued song], so "Up next" is your queued song. The old C is gone. This is the same quick push Crate already uses when you pick a song in Spotify mid-song (a tiny re-buffer blip may occur once, at queue time).
2. **When the queued song starts** (finish or skip), Crate pushes the next queued song behind it, or, if the queue is empty, the normal w song, then returns to the usual maze.
3. **Background helper note** is updated on queue: B = queued song, v = next queued song (or w), so a finish while the tab is asleep still lands on the queued song.
4. Queueing a 2nd/3rd song changes nothing in Spotify immediately (the head is already up next); it becomes up next when the head starts — as today.

## Technical details
- `queueTrack` (radio-context.tsx): after `steerSession(... queue: true)`, set `queued.current`, `upSkipRef`, `door`/landing plan to the queued track and call the existing fast-path push with `[current, queued]`; set `lineup` accordingly so the poll doesn't read it as a skip.
- Refresh the pending_handovers note (B/v) when the queue head or 2nd item changes.
- Skip-redirect branch (line ~1896) stays as a fallback.
- Update the AGENTS.md queue rule: queuing replaces Spotify's next-up once at queue time (accepted small glitch) instead of never touching the queued door.
- Add a test in user-queue tests: head → doors, after start the 2nd item becomes the pushed door, empty → maze.
