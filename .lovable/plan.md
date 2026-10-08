# Database tune-up

## What we measured (Sept 25 – Oct 8)
- Database cost: about 5.3 credits for ~68 active hours on the smallest size (pico). That is 0.4% of the project's spend; AI and building dominate.
- Network: about 0.5 credits. Background workers: about 4.9 credits.
- The slowest work is always the same thing: reading your whole library (~15,600 songs) and listening history (~19,000 rows) 1,000 rows at a time, again and again. The top four queries ran 3,000–4,300 times each, adding up to about 8 minutes of database time.
- The right indexes already exist; the problem is how often and how the reads are done.

## What changes
- Crate reads your library much less often: the song list loaded for picking doors and chatting is reused instead of reloaded for every pick.
- The library panel in the app keeps its song list for the session instead of reloading it on every open.
- Each page of songs is fetched with a faster method that doesn't slow down as it goes deeper into the list.
- Nothing about how Crate picks songs, remembers, or plays changes.

## What to expect
- Pages and door picks should feel snappier, especially on big libraries.
- Credit savings will be small, since the database is already the cheapest size and costs about 0.4 credits a day. Fewer reads may let it sleep a bit more; we compare active hours after a few days of normal use.

## Technical details
- `path.functions.ts` loadPool, `chat.server.ts` library/history loaders, `taste-synthesis.server.ts`: add explicit `.eq("user_id", userId)` (lets the planner use `(user_id, id)` / pkey indexes directly instead of relying on RLS), and switch OFFSET `.range()` to keyset pagination (`.gt("id", lastId).order("id").limit(1000)`; history by `spotify_id`). Raise the per-worker pool cache TTL from 5 to 15 min and invalidate it after library sync/import.
- `LibraryPanel.tsx`: move the full-library read into a TanStack Query with long `staleTime` and invalidate only after sync/import/demo changes; same keyset pagination ordered by `(source_period, id)`.
- `HistoryImport.tsx` / `SideRoads.tsx` history reads: same query caching.
- No schema changes, no deleted data, RLS unchanged. Verify with `slow_queries` call counts and mean times after a few sessions, then compare database active hours in usage.
