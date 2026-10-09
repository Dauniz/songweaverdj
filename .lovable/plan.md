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
2. **Default when there's no pattern or no memories:** no AI is used, so this is free and instant. Every group is picked at random, so the mix changes from visit to visit:
   - 2 all-time favorites: songs with more than 67 streams.
   - 2 current favorites: songs with more than 10 streams in the last 30 days.
   - 2 forgotten favorites: more than 20 streams, but 3 or fewer in the last 6 months.
   - 2 wildcards: any songs from your library.
   - If a group runs short, the gap is filled from the next group in this list, and the wildcards fill whatever is still missing.
3. **Always applied:** no duplicates (same title and artist counts as the same song), no songs on cooldown, and no songs you heard in the last 50.

## Technical details
- New `getStudioSuggestions` server function in `src/lib/suggestions.functions.ts` (auth-protected, input: tzOffsetMin). It reuses the weekday/time window from `welcome.functions.ts`.
- Pattern path: code builds a shortlist of about 40 songs from `library_tracks`, weighted by the window's top artists and genres. Then one gemini-3.6-flash call returns 8 spotify_ids plus a header line as strict JSON. Any id not in the shortlist is dropped and the gap is refilled from the shortlist.
- Default path: plain code using `isForgotten` from `pick-rules.ts`, `dedupePicks` and the cooldowns in `cooldowns.ts`.
- Client: a new `StudioSuggestions` component in MoodChat's empty state when `!sessionLive`. It uses React Query with key `["studio-suggestions", day, partOfDay]`, a long staleTime, and a sessionStorage copy. Play calls `rerootTo(track)` from radio-context, just like `LibrarySearch.play`.
- Thresholds live in `pick-rules.ts` (`isAllTimeFavorite` >67 streams, `isCurrentFavorite` >10 streams in the last 30 days, existing `isForgotten`), computed from the imported history.
- Unit tests for the default mix: 2/2/2/2 split, the >67 and >10-in-30-days thresholds, a random pick (not just the top songs), no repeats, and no songs on cooldown.
- Add an AGENTS.md rule for studio suggestions.
