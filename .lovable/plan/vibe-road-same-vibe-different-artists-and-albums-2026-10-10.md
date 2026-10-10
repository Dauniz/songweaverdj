# Vibe road: same vibe, different artists and albums

## Why it repeats today
- Vibe's 25-song shortlist starts with **5 songs by the current artist**, and those are put first.
- Crate's AI is told to pick what "sounds closest" to the songs you played through, and the closest sound is nearly always the same artist.
- Nothing stops the same artist or album from coming back two or three songs in a row.

## What changes
1. **Shortlist mix (still 25 songs)**
   - Same artist: **2 songs at most** (was 5). If that artist played in the last 3 songs: **none**.
   - Same genre tags (2+ shared): 10 songs, **at most 2 per artist and 1 per album**.
   - Same playlist mood (your playlist name tags, like "rainy" or "gym"): 7 songs from other artists.
   - Wildcards sharing at least one genre or mood tag: 6 songs, new artists first (not heard this session).
   - Unfilled slots still roll to the next group, so the road never runs dry.
2. **Variety rule for the pick**
   - The AI gets a short "recently played artists and albums" list and is told: same sound, different artist. The same artist is allowed only if nothing else fits.
   - A code check backs it up: if the AI picks an artist from the last 3 songs, or the same album as the last song, Crate takes the best other match from the shortlist instead.
3. **Better use of tags**
   - Songs are ranked by how many genre tags and playlist mood tags they share with the songs you played through this session, not just the current one.
   - The AI prompt tells it to rely on these tags plus its own knowledge of each artist's sound.

Era road, side roads, New Angle and prompt playlists stay as they are.

## Technical details
- `src/lib/pick-rules.ts`: rewrite `vibeShortlist` with new group sizes, per-artist/per-album caps, `recentArtists` input, tag scoring against the played-through set; add `violatesVariety(pick, recent)` helper.
- `src/lib/path.functions.ts`: pass recent artists/albums from history into `buildShortlist`; add a VARIETY line to the vibe prompt; after the AI pick, apply `violatesVariety` and fall back to the top-ranked alternative.
- `src/lib/pick-rules.test.ts`: tests for the caps (max 2 same artist, 0 if recently played, 1 per album) and the variety fallback.
- Update the Vibe line in `src/components/crate/AGENTS.md`.
