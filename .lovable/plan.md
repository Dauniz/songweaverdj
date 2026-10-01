# Sync recent data when starting or resuming a session

## What you get
- When you press **Start session** or **Resume last session**, a small popup asks: **"Sync recent data first?"** with two choices: **Sync & start** and **Skip**. It also shows when you last synced, for example "Last synced 3 days ago".
- The popup only shows if your last sync was more than about 6 hours ago. Otherwise the session starts right away, like today.
- **Sync & start** brings in what's new since your last sync, then starts the session:
  1. **New saved songs and playlist changes:** the same library sync as today. Songs you added since last time show up in the maze.
  2. **Recent listening:** the songs you've played in Spotify outside Songweaver are added to your listening history, with play counts and "last played" dates. That way Crate knows you just heard them and won't count them as forgotten favorites.
- A short status line shows progress ("Syncing your recent listening…"), and Crate starts as soon as the sync is done.

## An honest limit
Spotify only shares your **last 50 plays** with apps like Songweaver. If you've listened to more than 50 songs since your last sync, the older plays can't be fetched. The full history still has to come from the .zip/.json import. Syncing more often keeps the gap small. The popup will mention this in one short line.

## Technical details
- New server function `syncRecentListening` (spotify.functions.ts): `GET /me/player/recently-played?limit=50&after=<last recent sync ms>`. The `user-read-recently-played` scope is already requested. Plays are grouped by track. Each one is upserted into `listening_history`: plays and ms_played are added on, last_played is set to the latest play, first_played is kept, and the current year is bumped in `plays_by_year`. A play is only counted if it's newer than the stored last_played, so nothing is counted twice.
- New column `spotify_connections.last_recent_sync_at` (migration) stores the cursor.
- Library part reuses `syncSpotifyLibrary` as-is.
- `SessionControl.tsx`: the Start and Resume buttons open a `SyncRecentDialog` when `last_synced_at` is older than 6 h. The dialog runs both syncs, invalidates the library and listening-history queries, then calls `startSession()` or `resumeLastSession()`. Skip calls them directly.
- No change to maze, door or push mechanics.
