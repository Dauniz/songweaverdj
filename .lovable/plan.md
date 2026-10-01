# Prompt playlist: Crate's 6 picks play in order

## What changes for you
- When a prompt starts a session, Crate's 6 picks become a short playlist. Finish song 1 and song 2 plays, then song 3, and so on up to song 6.
- Each of the 6 cards gets a clear play button. Press one and the playlist starts from that song, then carries on through the rest in order (for example, starting at 3 plays 3, 4, 5, 6).
- Skips work the same as now. If you skip any song, Crate leaves the playlist and goes back into the maze from that point, using his normal skip rules and skip doors.
- After song 6 finishes, Crate goes back into the maze as usual.
- The starting road follows the prompt. A mood or vibe starts on Vibe Road, and nostalgia or memories ("old summers", "high school", deeper reflective prompts) start on Era Road. Crate reads the whole prompt and decides. He doesn't just look for keywords.
- The maze shows the next playlist song as "If you finish". "If you skip" is still Crate's own pick.

## How it works
```text
Prompt -> 6 picks [1..6] + road (vibe/era)
Playing k:  finish door B = pick k+1 (fixed)
            skip door C   = Crate's normal skip pick (+ its own skip w)
            v (skip after B) = Crate picks as usual
Finish k  -> play k+1, playlist continues
Skip      -> playlist ends, normal maze from the skip door
Finish 6  -> playlist ends, normal maze
```
Spotify's queue rules stay the same: the current song plus its skip door are in "next up", and the finish door is sent near the end of the song.

## Technical details
- `chat.server.ts`: add `start_road: "vibe" | "era"` to `recommend_tracks` and tell the AI to pick it from the prompt's intent. Return it with the cards.
- `radio-context.tsx`:
  - New `promptQueue` ref holding the remaining picks (ordered from the chosen start index) and the cursor.
  - `startRadio` / `startOrReplan` accept the queue and the AI's road. They use the AI's road and fall back to the existing NOSTALGIA regex only if it's missing.
  - Wherever the finish door is chosen (initial session entry, `handOver`'s next-branch scouting, `checkPlan` / `doorProblem` repair), the next queued pick is used as B while the queue lasts. Crate still scouts v (B's skip), C and w as usual. `doorProblem` never replaces a queued B: a queued song is the user's intent, not a repeat.
  - On finish of a queued song, move the cursor forward. On any skip, a reroot (search, new prompt, or a song started in Spotify) or a session stop, clear the queue. Remove queued songs that can't be played.
- `MoodChat.tsx`: pass the 6 picks plus the road into `startRadio` from both the auto-start and the card button.
- `TrackCard`: add a visible play icon button, keeping the existing card click.
- Door debug: label B "(playlist k+1/6)" while the queue is active.
- Update `src/components/crate/AGENTS.md` and the "How Crate uses Walrus" page with the new rule.
