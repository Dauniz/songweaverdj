# Tune Crate's picking rules

## 1. Finished means really finished
- A song counts as **finished** only if it plays to its end and Spotify moves on to the finish door. Anything earlier counts as a **skip**, even at 95%.
- This replaces the 70% line, so a song can't count as finished and skipped at once.
- At the end of a song, a few seconds of leeway allow for Spotify's lag. The background finish helper uses the same rule.

## 2. Era road scores
| Rule | New | Old |
|---|---|---|
| Small playlist (20 songs or fewer) | +3 | 120 or fewer |
| Medium playlist (21–120 songs) | +1.5 | up to 400 |
| Huge playlist (over 120 songs) | +0.5 | over 400 |
| Saved within 7 days of the anchor | +2 | 14 days |
| Saved within 15 days | +1 | 31 days, +0.5 |
| Same artist | no points | +0.5 |
| Score needed to qualify | **2.5** | 1.2 |

The random tie-breaker (0–0.4) stays. If no song reaches 2.5, Crate falls back to the era hop, then to the AI pick, so the road never runs dry.

## 3. Vibe road shortlist: 25 songs (was about 75)
- **5 by the current artist, with the same vibe.** Songs with the same genre tags come first, so a jazz song by that artist leads to their other jazz songs. Other songs by the artist fill any gap.
- **10 with the same genre** as the current song.
- **5 wildcards** that still share at least one genre or tag.
- **5 with the same energy.** Spotify no longer shares loudness or decibel data with new apps, so Crate can't measure it. Instead, these come from playlists Crate has read as the same mood (section 5), for example another "gym" or "calm" playlist. Gemini then judges the energy.
- Any slot that can't be filled goes to the next group.

## 4. New Angle shortlist: 15 songs
- **10 random songs** that share no genre, tag or artist with the session so far.
- **5 forgotten favorites** (new definition in section 6).

## 5. Playlist names carry real weight
- The first time a playlist syncs, or when you import your streaming history, Crate reads each playlist name, emojis included, together with a sample of its songs. He writes down what the name means. For example, "🌧️" means rainy, melancholic and calm, and "Gym 🔥" means high energy and workout. He saves short mood and scene tags for each playlist.
- This runs once per playlist. A renamed playlist is read again.
- **Where the tags are used:**
  - in the energy group on Vibe road
  - as a real signal in the AI's pick (no longer a weak tie-breaker)
  - in chat picks and in memory learning
- Your rule still holds: what you actually listen to outweighs what a playlist is called.

## 6. Forgotten favorite, one definition everywhere
- A forgotten favorite is a song with **more than 20 streams** in total and **3 or fewer streams in the last 6 months**.
- **Where it's used:**
  - New Angle
  - the AI's history hints
  - Deep cuts: same 20-stream minimum and 6-month window (today it's 15 streams and 1 year)
- Without imported history, Crate keeps today's fallback: songs saved long ago that sit in only one place.

## Technical details
- `radio-context.tsx`:
  - The finish outcome becomes "played" only when the song ended naturally. Two signals count: Spotify moved on to the expected B or v, and the last progress was at least `duration - ~4 s`. The `ratio >= 0.7` check goes away.
  - `handover-tick.ts` gets the same check.
- `path.functions.ts`:
  - `eraCandidates`: new playlist size bands (20 / 120), day windows 7 / 15, the same-artist bonus removed, and the cutoff set to 2.5.
  - `buildShortlist`: rewrite the vibe and mixed groups as described above, using `library_tracks.genres` plus playlist tags.
  - `isForgotten`: replace it with a shared helper that uses `plays_by_year` and `last_played` for the 6-month count.
- **Playlist reading:**
  - New `playlist_meanings` table (user_id, playlist_name, meaning, tags[]), with RLS and grants.
  - A Gemini 3.6 Flash batch call runs after library sync and after a history import, only for playlist names it hasn't read yet. It receives the name and about 15 sample songs.
  - The tags are added to `describe()` in the picking prompt and to the chat library lines. The playlist-name wording in the prompt goes from "weak" to "meaningful".
- **Deep cuts:** update `alt-roads.ts` and the info text in `lenses.ts`.
- **Tests:**
  - the finished vs skipped rule
  - the era scores and 2.5 cutoff
  - the vibe shortlist group sizes
  - the forgotten favorite definition
- **Notes:** update `src/components/crate/AGENTS.md` and the "How Crate uses Walrus" page.
