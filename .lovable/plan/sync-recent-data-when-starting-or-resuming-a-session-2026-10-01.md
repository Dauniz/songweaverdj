# Sync recent data when starting or resuming a session

## What you get
- When you press **Start session** or **Resume last session**, a small popup asks **"Sync recent data first?"** with two choices: **Sync & start** and **Skip**. It also shows when you last synced, for example "Last synced 3 days ago".
- The popup only shows if your last sync was more than about 6 hours ago. Otherwise the session starts right away, like today.
- **Sync & start** only fetches what's new. It does **not** re-sync your whole library:
  1. **Newly liked songs:** Spotify lists your liked songs newest first. Crate reads only until he reaches a song you'd already liked at your last sync, then stops. That's usually one request.
  2. **Changed playlists only:** Spotify gives each playlist a "version" tag that changes whenever songs are added. Crate compares it with the tag from your last sync and skips every playlist that hasn't changed. Only songs that are new in a changed playlist get added.
  3. **Recent listening:** songs you played in Spotify outside Songweaver are added to your listening history, with play counts and "last played" dates.
- A short status line shows progress, and the session starts as soon as the sync is done. This is a handful of requests instead of hundreds, so it stays well clear of Spotify's limits.

## Honest limits
- Spotify only shares your **last 50 plays** with apps like Songweaver. Anything older still needs the .zip/.json import. Syncing often keeps the gap small.
- Songs **removed** from playlists stay in Songweaver until your next full sync. Only additions are picked up.
- The first quick sync after this update has no saved playlist versions yet. It saves them and skips the playlists, so it only adds new liked songs and recent plays. Every later quick sync can also pick up playlist additions.

## Technical details
- Migration:
  - `spotify_connections.last_recent_sync_at timestamptz` stores the recently-played cursor.
  - New table `spotify_playlist_snapshots (user_id, playlist_id, snapshot_id, updated_at)` with GRANTs and own-row RLS. The full `syncSpotifyLibrary` also writes snapshots from now on.
- New server fn `syncRecentSpotify` (spotify.functions.ts), which reuses the existing token refresh and pacing:
  - Liked: page `/me/tracks?limit=50` and stop once `added_at` is at or before `last_synced_at`.
  - Playlists: `/me/playlists` lists each playlist's snapshot. Changed or new playlists are paged, and only tracks with `added_at` after `last_synced_at` are inserted, skipping any already in `library_tracks` for that source. Genre lookup happens only for new artist ids.
  - Recent: `/me/player/recently-played?limit=50&after=<cursor>`, then upsert into `listening_history`: add to plays/ms_played, keep the latest last_played, bump the current year in plays_by_year, and count only plays newer than the stored last_played.
  - Update `last_synced_at`, `last_recent_sync_at` and the snapshots.
- `SessionControl.tsx` + new `SyncRecentDialog`: the 6 h gate runs the sync, invalidates the library and history queries, then calls `startSession()` / `resumeLastSession()`. Skip calls them directly.
- No change to maze, door or push mechanics.
