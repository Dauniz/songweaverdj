# Check doors early + softer skip rules + new road ladder

## What actually happens today
- The line "avoiding Linus Hasselberg, Clem Beatz · 18 songs already heard excluded" is only Crate thinking out loud. It doesn't swap anything by itself.
- The swap happens the moment you skip. Skipping adds one to that artist's skip count. When the count reaches the limit, the artist is blocked. Crate then throws away the skip door he already picked (C) and picks a new song. But Spotify is already playing C, so the new song has to be pushed in. That's the glitch.
- Doors are also picked without asking "what if this skip changes the rules?". So a door can be valid when picked and invalid the moment it opens.

## Part 1 — Check doors early (approved)
1. **Picking ahead with "what if".** When Crate picks C (if you skip A), he already counts A's skip and the road change it causes. The same goes for v (if you skip B) and w (if you skip C).
2. **Ongoing door check.** The regular door check (B, v, C, w) also asks of each door:
   - Is it a song already heard?
   - Is its artist blocked, or would it be blocked by the skip that opens this door?
   - Does it repeat another door?
   If any answer is yes, Crate picks a new one while the current song still plays. B, v and w aren't in Spotify yet, so fixing them costs nothing. C is fixed early in the song, together with the normal skip-door push.
3. **No swap after a door opens.** If Spotify already started a door, Crate keeps it and only notes it in the log.
4. **Log lines**, for example "DOOR CHECK: replaced w — artist would be blocked after this skip" or "DOOR CHECK: B, v, C, w all valid".

## Part 2 — New rules
### Songs already heard
- A song that has started is left out for the next **50 songs** (was 500). After that it can come back.
- Everything resets when a new session starts. Resume keeps it.

### Artists
- **Skips 1–4 of an artist:** the artist is "cooling down" for the next **5 songs**. Crate can still pick them, but he moves them to the back of the line and tells the DJ to prefer others. Each new skip restarts the 5-song cool-down.
- **Skip 5 of the same artist in one session:** blocked for the rest of the session.
- Everything resets when a new session starts.

### Road ladder (skips in a row)
Starting on Vibe Road:

```text
skip 1 -> Vibe Road again (maybe it was the song, not the vibe)
skip 2 -> Era Road
skip 3 -> Era Road, a nearby era (a couple of years earlier or later)
skip 4 -> Era Road, another nearby era
skip 5 -> New Angle
```

Starting on Era Road, it works the other way round:

```text
skip 1 -> Era Road, a nearby era (a couple of years earlier or later)
skip 2 -> Vibe Road
skip 3 -> Vibe Road again
skip 4 -> Vibe Road again
skip 5 -> New Angle
```

- Finishing a song resets the count, and the finish door stays on the road you're on.
- New Angle still only appears as a skip door, now after 5 skips in a row (was 2).
- The "Cool your jets" warning and the steering prompt are unchanged.

## Technical details
- `radio-context.tsx` `advance()`: replace the road switch with the ladder above, keeping track of the starting road (`baseRoad`) and adding `eraShift: true` for the nearby-era steps. `played` is sent as `slice(-50)`.
- Artist state: `artistSkips` stays (block at ≥5). Add `artistCool: Map<artist, songsLeft>` set to 5 on each skip and counted down on every song change. Both are reset in `startRadio` and saved/restored with the live session.
- `nextPathTrack` / `pathReserves`: new inputs `coolArtists` and `eraShift`. Cooling artists are pushed to the end of the shortlist and marked "(cooling)" in the DJ prompt, with a rule to prefer others. With `eraShift`, `eraCandidates` scores songs whose saved date is 1–3 years from the anchor, from a different playlist, instead of the closest days.
- `projectedAvoid` / `doorProblem` use the new 5-skip threshold and the cooling list for the "what if" checks. Update the copy on the How Crate uses Walrus page (roads, skips) to match.
- The text in the maze header ("Skip it -> Crate turns. Two skips -> a new angle") is updated to describe the new ladder.
