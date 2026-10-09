# Crate's song-picking rules today (reference for tuning)

Nothing changes yet. This is how Crate works right now, read from the code. Mark what you want different, and I'll turn your notes into the tuning plan.

## 1. Every pick, step by step
1. **Start from your whole library**, with copies of the same song merged.
2. **Remove:** the song playing now, songs already used as doors, songs heard in the **last 50**, and artists **blocked** this session.
3. **Resting songs sit out** because of a skip cooldown (section 5). If that would leave nothing, they're allowed back in.
4. **Cooling artists go to the back of the line.** These are artists skipped in your last 5 songs, or artists on cooldown. They can still be picked, just less often.
5. **Anchor** = the last song you played through. If there isn't one yet, it's the song the session started from.
6. **Road:** an alternative road if one is on, otherwise Vibe, Era or New Angle, depending on the skip ladder.
7. **Door check:** each lined-up door is checked against the moment it would play. It must not be heard already, its artist must not be blocked, and it must not repeat another door. A door that's already queued in Spotify is never swapped.

**Finished vs skipped:** a song counts as finished once **70%** of it has played. Anything less counts as a skip.

## 2. Skip ladder (default roads)
| Skips in a row | Road | Notes |
|---|---|---|
| 0 (finished) | Your base road (Vibe or Era) | The ladder resets |
| 1 | Same road | On Era, it hops to a nearby era (1–3 yrs) |
| 2 | The other road | |
| 3 | The other road | On Era, it hops eras again |
| 4+ | New Angle | Ends the moment a song plays through |

The base road comes from your prompt. Crate reads the whole prompt and picks Vibe or Era. If he gives no answer, nostalgia words choose Era, and everything else gets Vibe.

## 3. Era road (plain code, no AI, instant)
Each song gets a score against the anchor:
- **Shares a playlist with the anchor:** +3 for a small playlist (120 songs or fewer), +1.5 for a medium one (up to 400), +0.5 for a huge catch-all
- **Saved within 14 days of the anchor:** +2. Within 31 days: +0.5
- **Same artist:** +0.5
- **Random jitter:** +0 to 0.4
- A song needs a score **above 1.2** to qualify. Crate picks at random among the **top 6**.
- **Era hop** (after skips 1 and 3): songs saved **330–1100 days** away from the anchor, closest to about 2 years. Songs from a different playlist get +1.
- Cooling artists are left out if 10 or more other songs remain.
- If you send a steer message, Era switches to an AI pick for the rest of the session.

## 4. Vibe road and New Angle (AI pick)
- **Vibe shortlist (about 75 songs):** 20 by artists you finished this session, 10 "forgotten" songs, and the rest spread across all your playlists, with less-saved songs first.
- **New Angle shortlist:** only artists not played this session. 8 forgotten songs, 45 spread across playlists, and 30 random.
- **Gemini 3.6 Flash** picks one song by how it **sounds**: instruments, production, genre, tempo, vocals and mood. Era and playlist don't count. Playlist names are a weak tie-breaker only.
- **The AI also sees:**
  - the time and weekday
  - your songs played and skipped this session
  - your stream counts (a song with many plays but none recently counts as a forgotten favorite)
- **The AI follows this priority:**
  - live session signals (skips, steer)
  - long-term anchors
  - your history profile
  - Feedbacker notes
  - steer insights
  - session observations

## 5. Restrictions and cooldowns
| Rule | Value |
|---|---|
| Heard songs excluded | Last 50 songs |
| Artist cooling (demoted) | Skipped in your last 5 songs |
| Artist blocked this session | 5 skips in the session |
| Song cooldown | 2 early skips within your last 3 sessions: it rests for 2 sessions |
| "Don't suggest this again" | Rests for 3 sessions |
| Artist cooldown | 3 early skips in one session: plays less often for the next 2 sessions |
| Finishing a resting song | Ends its cooldown right away |
| Cooldown lookback | Last 60 days of listening |
| Old "never again" memories | Ignored |

## 6. When an alternative road is on
- It **replaces** Vibe, Era and New Angle, along with their ladder. Code narrows your library to about **15 songs**, then the AI picks one using the road's own rule.
- Turning a road on or off mid-song works like a steer. The song playing and its skip door stay, and the finish door plus its skip doors are picked again.
- **Wormhole:** each year you streamed a song gives min(plays, 25) + 4 points, and a song needs **27 or more**. Without history, it uses songs that sit in 2 or more playlists. Skips don't change the road.
- **Texture:** sound groups (piano, ambient, acoustic, electronic, hip-hop, rock, jazz & soul, pop) come from Spotify's genre tags. On skips 2, 4, 6 and so on it moves to a new texture that has at least 3 songs.
- **Deep cuts:**
  - With history: songs with 15+ streams that you haven't played in over a year, or that were favorites in an earlier year with 3 or fewer plays this year.
  - Without history: songs saved over a year ago that sit in only one place.
  - It stays within ±1 year. On skips 2, 4, 6 and so on it jumps to another era at least 2 years away.
- **Scene:**
  - Finished songs: 8 songs by the original artist, plus 2 each from their top 6 collaborators.
  - 1 skip: back to the original artist.
  - 2–3 skips: a featured artist.
  - 4+ skips: a new artist who shares genre tags.
- If the road runs out of songs, the label shows "(none left)" and the default pick is used.

## Next step
Tell me what to change, for example:
- the 70% finish line
- "heard" covering 50 songs
- the Era scores or the 1.2 cutoff
- the ladder steps
- block after 5 skips
- the cooldown lengths
- the shortlist sizes
- the Wormhole cutoff of 27
- the Texture groups

I'll write each change as an exact rule, add a test for each one, and update the rule notes.
