# Lower Songweaver running costs

## What the numbers say (this billing period, Sep 3 - Oct 3)

| Item | Credits | Share |
|---|---|---|
| Crate's AI (song picks, chat, reflections) | ~490 | 57% |
| - of which "cache write" tokens | ~455 | 53% |
| Building the app with Lovable (not a running cost) | ~364 | 42% |
| Database, hosting, traffic | ~2.7 | <1% |

The database is almost free (pico size, ~1 credit). Real running cost is Crate's AI, and almost all of it is one specific line: "cache writes". That happens when a long prompt is sent and the start of it differs every time, so the AI pays to store it but never reuses it.

## Plan

### 1. Make Crate's song-pick prompt cache-friendly (biggest win)
The DJ prompt puts things that change every call (current time, played/skipped songs, chips) at the very top, and the ~140-song candidate list plus memories below. Every call is "new" to the cache.
- Reorder: fixed instructions first, then memories (change rarely), then candidates, and the per-song live state (time, history, chips, road) last, in the user message.
- Same reorder for the chat and the reflection prompts.
- Check the AI logs after a live session to confirm cache writes drop and cached reads rise.

### 2. Fewer AI calls per song
- Today each new song triggers AI picks for both doors (finish and skip). Keep the finish pick on AI, but let the skip door use the code-based pick (like the reserves) when the listener is not steering (no chips, no AI side road). Vibe/New angle keep AI for the main pick.
- Skip the AI call entirely when a cached pick for the same song + road + side road already exists (e.g. after toggling back).

### 3. Lighter reflections
- Background reflection every 7 events currently runs the big "history" pass (up to 600 events) once there are 21+ events. Change to: frequent passes use "session" scope; the history pass runs at most once per day per user and at session end.
- Skip reflection if fewer than 5 new active events since the last one.

### 4. Database tidy-up (small cost, faster pages)
The slowest queries all read the whole library (14k rows) in 1000-row pages: the library panel (~2,950 calls), the song-pick pool (~1,570), chat, and search.
- Add indexes on library by user + period and user + id, and a text index for search.
- Library panel: keep the loaded library cached between visits instead of refetching the full list each time.
- Chat: reuse the same 5-minute library cache the song picker already has.

## What will not change
Song choice quality, the maze behaviour, memory writing and search results stay the same. Nothing is deleted.

## Expected effect
Steps 1-3 target the ~490 AI credits; realistic reduction is roughly half or more. Step 4 mainly makes things snappier; database cost is already negligible and stays at pico size.

## Technical details
- `src/lib/path.functions.ts`: move `nowLabel`, liked/skipped, chips, roadRule, lensRule into the user message; system = static rules + memories + candidates (candidates sorted stably). Add in-memory pick cache keyed by seed id + road + lens + deepCuts + chips.
- `src/components/crate/radio-context.tsx`: skip-door prefetch calls `pathReserves` (count 1) when no chips/AI lens; reflect cadence: session scope every 7 logs, history only at stopRadio or if last history run >24h (timestamp in localStorage per user).
- `src/lib/chat.server.ts`, `taste-synthesis.server.ts`: static-first prompt order; chat uses shared pool cache.
- Migration: `create index on library_tracks(user_id, source_period desc, id)`, `(user_id, id)`, `pg_trgm` GIN on name/artists/album.
- `LibraryPanel.tsx`: `staleTime: 10 min` on the library query.
