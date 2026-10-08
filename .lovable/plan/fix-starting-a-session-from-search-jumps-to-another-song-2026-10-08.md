# Fix: starting a session from search jumps to another song

## What's likely happening
When you start from a search pick, Crate sends your song (plus its skip door) to Spotify. It then ignores Spotify's reports for only ~1.5 s. Spotify often keeps reporting the song it was playing before for a second or two longer. Crate reads that old song as "you picked something in Spotify", follows it, and builds a new maze from there. That matches what you saw: the song changes immediately and a maze starts from the wrong song.

We fixed the same kind of lag earlier for the finish hand-over, but the session-start path still uses the short timer. This diagnosis comes from reading the code, not from your maze log, which is stored in your browser. Step 1 confirms it.

## Fix
- After a fresh start (search, prompt, welcome card or resume), Crate keeps ignoring other songs until Spotify actually reports the song it sent, with a maximum of about 8 s. The fixed ~1.5 s timer goes away.
- During that window, an old song Spotify reports is never treated as your pick or a skip. If 8 s pass and Spotify still plays something else, Crate falls back to today's behaviour and follows it, so a real change you make in Spotify is still respected.
- The Start button's "keep the playing song" behaviour is untouched, because it doesn't send a new song.

## Steps
1. Add a maze-log line when a report is ignored during startup ("Waiting for Spotify to switch to X"), so your next test confirms the cause.
2. Replace the 1.5 s release with "released once Spotify reports the start song, or after 8 s".
3. Add one line to the radio rules notes.

## Technical details
- `src/components/crate/radio-context.tsx`
  - In the session-start effect (~line 1151–1198): stop calling `setTimeout(release, 1_500)`. Leave `startingFor` set after `startSpotifyPlayback`, with `at` reset to the send time.
  - In the playback poll (~line 1584): while `startingFor.id === current.spotify_id`, if the report's `spotifyId === startingFor.id`, clear `startingFor` and continue. Otherwise, if under 8 s since the send, return (log once). Raise the 10 s cap there to send time + 8 s.
  - Keep the existing `lastPlayback` reset (`observed: false`) so the first real report counts as "seen".
- `src/components/crate/AGENTS.md`: replace/extend the poll-lag rule to cover session starts.
- Verify with `bunx tsgo --noEmit`, then a real test: start from search while Spotify is playing another song.
