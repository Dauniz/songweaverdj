# Crate picks the skip song one step ahead

## Goal
Crate should never change Spotify's "Next up" in the middle of a song. When you skip, Spotify should already have the next skip song lined up, so no list is resent after the song has started.

## How it will work

```text
Song A plays     Spotify has: [A, B, C]
                 B = A's "if you skip"
                 C = B's "if you skip" (picked right after B)

Skip -> B plays  Spotify already has C next. Nothing is resent.
                 The screen shows C as B's "if you skip".
                 In the background, Crate picks B's "if you finish" song and
                 D = C's "if you skip". Both stay in Songweaver for now.

B plays to end   Normal handover just before the end:
                 [B's finish, its skip, that skip's skip], sent in one list.

Skip -> C plays  The new list [C, D, D's skip] goes to Spotify right away,
                 while C is still at about 0:00, before the song gets going.
```

- **Session start:** Crate picks the finish song, the skip song B, and then C (B's skip song) before playback starts. It sends [A, B, C] as one list, as it does today with two songs.
- **First skip:** no resend at all, so there's no glitch.
- **Mid-song:** Crate never sends a list mid-song. New picks are kept in Songweaver until the next natural moment: the end of the song, or a skip onto a song that has nothing lined up after it in Spotify.
- **Rapid skips:** the existing rule stays. A second skip within the quiet second pauses Spotify and shows "Cool your jets". After the break, Crate rebuilds [current, skip, skip's skip] and resumes.
- **Screen and Spotify stay matched:** the "if you skip" song on screen is always the song right after the current one in the last list Spotify accepted.

## Trade-off
Spotify only reports a new song about once a second. So when a list does need sending on a skip, it goes out within roughly the first second of the song, not at exactly 0:00. That's much quieter than a resend several seconds in. Most of the time, though, it won't be needed, because the step-ahead song is already in Spotify.

## Technical details
- `radio-context.tsx`: lineup becomes `[current, skip, skipAhead]`. Add a `skipAhead` ref next to `door`, tagged with the generation number and the `forId` of the skip song.
- After the skip door resolves, chain a `fetchBranch("skipped")` from the skip track to fill `skipAhead`, with the finish and existing skip tracks excluded to avoid duplicates. Use a timeout and fall back to a quick pick from the library.
- In the skip-landing observer: if the observed track equals the lineup's skip and `skipAhead` is already in Spotify, adopt it as the displayed door. Don't send anything. Scout the finish song and the next step ahead, and store them without sending.
- If the observed track has no successor in the accepted lineup, send immediately with `positionMs` taken from the observation, without waiting for the quiet second. The quiet second still gates scouting.
- Handover and resume both send 3-song lists. Keep the generation guards, the one-send-at-a-time lock and the send log in SpotifyLogPanel, and log the reason as `skip-ahead` / `landing-resend`.
- Update the playback rule in AGENTS.md to `[current, skip, skip-ahead]`, with no resends mid-song.
