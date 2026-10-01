# Check doors early, so nothing is swapped after a door opens

## What actually happens today
- The line "avoiding Linus Hasselberg, Clem Beatz · 18 songs already heard excluded" is only Crate thinking out loud. It doesn't swap anything by itself.
- The swap happens the moment you skip. Skipping adds one to that artist's skip count. If that count reaches 2, the artist is now blocked. Crate then looks at the skip door it already picked (C). If C is by a blocked artist, he throws C away and picks a new song. But Spotify is already playing C, so the new song has to be pushed in. That's the glitch.
- The doors were also picked without asking "what if this skip blocks an artist?". So a door can be valid when picked and invalid the moment it opens.

## How Crate decides (current rules)
1. **Songs already heard:** every song that started this session, whether you finished it or skipped it, is left out for the rest of the session (up to the last 500). This survives Resume.
2. **Blocked artists:** each skip counts against that song's artist name. After 2 skips of the same artist in one session, that artist is blocked for the rest of the session. Finishing a song never removes a skip. The name must match exactly as Spotify writes it, so "Linus Hasselberg, Clem Beatz" counts separately from "Linus Hasselberg".
3. **Never the same song twice in the doors:** the finish door and the skip door can never be the same song, and each door's own next pick leaves out the song you're on and the other door.
4. **Roads:** finishing keeps the road. One skip turns to the other road. Two skips in a row open New Angle, and only as a skip door. Finishing a song resets the count.
5. **Side roads:** Wormhole and Deep cuts narrow which songs can be picked. Scene, Wave and Texture only change how the DJ chooses.

## What changes
1. **Picking ahead with "what if".** When Crate picks C (if you skip A), he already counts A's skip. If that would block A's artist, he leaves that artist out of C and w. The same goes for v (if you skip B): B's skip is already counted.
2. **Ongoing door check.** The regular door check (B, v, C, w) now also asks of each door:
   - Is it a song already heard this session?
   - Is its artist blocked, or would it be blocked by the skip that opens this door?
   - Does it repeat another door?
   If any answer is yes, Crate picks a new one right away, while the current song still plays. B, v and w aren't in Spotify yet, so fixing them costs nothing. C is fixed early in the song, together with the normal skip-door push, never at the moment you skip.
3. **No swap after a door opens.** If Spotify already started a door, Crate keeps it, even if a rule says otherwise, and only notes it in the log. No mid-song replacement means no glitch.
4. **Clear log lines.** For example: "DOOR CHECK: replaced w — artist would be blocked after this skip" or "DOOR CHECK: B, v, C, w all valid".

## Technical details
- `radio-context.tsx`: add `projectedAvoid(outcomeArtist?)`, which is `avoidArtists()` plus that artist when its count would reach 2. Pass it as the `avoidArtists` override to `fetchBranch` for C (A's artist), w (A's artist plus C's artist when that skip would block it) and v (B's artist).
- Add `doorProblem(track, projectedAvoid, otherIds)` checking `played.current`, avoid list and duplicates. Use it inside `checkPlan` for B, v, C, w and repair the failing slot through the existing repair path. Repairing C goes through the normal skip-rebuild push and only happens before the hand-over window.
- In `accept` (around line 836): drop the `avoidArtists().includes(...)` refetch when the chosen branch is the song Spotify is now playing. Log a note instead.
- No changes to road logic, the 2-skip rule, prompts or `path.functions.ts`.
