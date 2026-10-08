# No repeated songs in Crate's 6-song prompt playlist

## What changes for you
- When a prompt starts a session (or steers one), each of Crate's 6 picks is a different song. The same song can't show up twice.
- "Same song" means the same Spotify track, or the same title by the same artist. That catches copies of a song that sit in several of your playlists.
- If Crate repeats himself, the repeat is quietly dropped. If that leaves fewer than 6 songs, Crate fills the gap with other songs from your library that fit the prompt, so you still get 6 cards.
- During a live session, the song that's playing can't be one of the picks either.

## Technical details
- `src/lib/chat.server.ts` (`recommend_tracks` execute):
  - Remove duplicate picks by code, then by `spotify_id` after merging the full rows, then by lowercased `name|artists`. Keep the first one.
  - If a fresh start ends up with fewer than 6 picks, fill the gap from the remaining indexed library tracks. Prefer tracks that share an artist or genre with the kept picks, and skip anything already used.
  - Add "6 distinct songs, never the same song twice" to the prompt rule.
- `src/components/crate/radio-context.tsx` `startOrReplan` / `startRadio`: as a backstop, remove duplicates from the queued list by `spotify_id` and `name|artists`. Mid-session, also drop the song that's playing.
- Add a small unit test for the duplicate-removal helper (`src/lib/dedupe-picks.ts` plus a test file): same id, and same title and artist with a different id.
