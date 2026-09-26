# Songweaver Sessions: live link with Spotify

## How it works today
Songweaver checks Spotify every few seconds. If the song playing in Spotify changes to one Songweaver didn't pick (you skipped in Spotify, or searched and played something), Songweaver counts it as a skip and **pushes its own next song**. That overrides the song you chose. There is also no clear start or end, so Songweaver keeps controlling Spotify until you close the tab.

## What we'll build
1. **Start session button** in the Studio. Starting a session links Songweaver to your Spotify. Sending a prompt or pressing play starts one automatically.
2. **Live sync both ways while a session runs:**
   - Skip in the Spotify app: Songweaver sees the skip, follows the skip road, and queues the next song. It shows up in the Maze box.
   - Search and play your own song in Spotify: Songweaver treats it as the new starting point and doesn't override it. The next songs build from it, so it becomes the new "You are here" in the maze.
   - Pause in Spotify: Songweaver waits and doesn't count it as a skip.
3. **Session status pill** next to the Spotify card showing "Session live" and a small **End session** button.
4. **End session:** Songweaver stops controlling Spotify, and Spotify goes back to working as usual. Closing the tab or leaving Spotify idle for about 30 minutes also ends the session.
5. **Start session options:** a small choice appears when you start: **Start session** (uses your last sync, shown as "Library synced 3 days ago") or **Sync new songs first**, which runs the usual sync with its progress bar and then starts.

## Technical details
- `radio-context.tsx`: add `sessionActive` state with `startSession()` and `endSession()`. Poll only while a session is active.
- Tell apart three cases in Spotify: a skip (Spotify's own next track, or progress reset), our own queued track, and a track the user chose (not in our picks) that re-roots the path through `startRadio(startAt)`.
- Use Spotify's add-to-queue command to line up our next pick, so a skip in the Spotify app lands on Crate's choice.
- Show the last sync date from `spotify_connections.last_synced_at` through the existing server function.
- New `SessionControl.tsx` component next to `LibraryPanel`.
