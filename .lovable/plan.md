# Crate's song suggestions on the Studio start screen

## Your questions first
- **Cost:** 8 songs costs about the same as 4. Crate picks all of them in one AI request, and the extra 4 song names are a tiny part of that. One request is a small fraction of a credit.
- **Speed:** about 2–4 seconds either way. The page doesn't wait: the cards fade in when they're ready, and everything else works straight away.
- **Saved picks:** Crate keeps the 8 picks for the current weekday and time of day (morning, afternoon, evening, night). Coming back to the Studio within that window shows them instantly at no extra cost.
- **Recommendation:** keep 8. On phones only the first 4 show, so the screen doesn't get crowded.

## What you'll see
- When no session is live, a row of song cards sits at the very top of the Chat tab, above the heading, text, search bar and prompt box. Each card shows the cover, the title and the artist.
- Each card has a play button. Pressing it starts a session with that song as the anchor, the same way picking a song from search does: the same start order (skip door first), the same doors and the same maze.
- There's a short header above the cards, for example "Your Monday night picks" when Crate found a pattern, or "Picked for you" when it's the default mix.
- The cards go away once a session starts. If Crate's welcome guess card shows, it stays where it is now.

## How Crate picks
1. **Pattern first:** Crate looks at your listening on the same weekday within ±2 hours over the last 8 weeks. He also uses strong memories (anchors and the long-term profile) and asks Walrus about "Monday night listening". If he finds 3 or more sessions in that window, the 8 songs follow that habit.
2. **Default when there's no pattern or no memories:** 4 favorites (most streamed or most finished), 2 forgotten favorites (more than 20 streams, 3 or fewer in the last 6 months), and 2 wildcards (random songs from your library). No AI is used, so this is free and instant.
3. **Always applied:** no duplicates (same title and artist counts as the same song), no songs on cooldown, and no songs you heard in the last 50.

## Technical details
- New `getStudioSuggestions` server function in `src/lib/suggestions.functions.ts` (auth-protected, input: tzOffsetMin). It reuses the weekday/time window from `welcome.functions.ts`.
- Pattern path: code builds a shortlist of about 40 songs from `library_tracks`, weighted by the window's top artists and genres. Then one gemini-3.6-flash call returns 8 spotify_ids plus a header line as strict JSON. Any id not in the shortlist is dropped and the gap is refilled from the shortlist.
- Default path: plain code using `isForgotten` from `pick-rules.ts`, `dedupePicks` and the cooldowns in `cooldowns.ts`.
- Client: a new `StudioSuggestions` component in MoodChat's empty state when `!sessionLive`. It uses React Query with key `["studio-suggestions", day, partOfDay]`, a long staleTime, and a sessionStorage copy. Play calls `rerootTo(track)` from radio-context, just like `LibrarySearch.play`.
- Add `dedupe`/default-mix unit tests: 4/2/2 split, no repeats, cooldown songs excluded.
- Add an AGENTS.md rule for studio suggestions.
