# Push the finish song at the very end of the playing song

## Today
Crate sends the finish song (plus its skip door) about 3 seconds before the playing song ends. That was chosen to avoid an old bug where Spotify skipped straight past the finish song — but it cuts off the last seconds of the song, which you hear.

## Change
- Crate sends the finish pair right as the song ends instead: the timer aims for the final moment (about 0.3 seconds before the end, just to cover the network round-trip to Spotify), not 3 seconds early.
- The safety net for the old bug already exists and stays: if Spotify still jumps straight past the finish song, Crate notices (the finish song never showed as playing) and re-sends it once, without counting it as your skip.
- The background finish helper (used when the page is asleep on phones/tablets) gets the same timing, so both paths behave identically.

## What you may notice
- The playing song now runs to its real end — no more cut fade-outs.
- In exchange there can be a very short silence (a fraction of a second) while Spotify starts the next song, since it begins loading only at the end. This is the trade-off of pushing at the literal end; the early push existed to hide exactly that gap.

## Technical details
- `src/components/crate/radio-context.tsx` `handOver`: change the final wait from `end - 3_000` to about `end - 300`, and update the comment. The pre-send Spotify re-check, the hand-over guard and the one-time recovery stay unchanged.
- `src/routes/api/public/handover-tick.ts`: change its matching `remaining - 3_000` wait to the same ~0.3 s offset.
- Verify with mocked playback: (a) send fires within ~0.5 s of the song end; (b) a Spotify jump-past is still recovered once with no skip logged; (c) a user skip right before the end still cancels the hand-over.
