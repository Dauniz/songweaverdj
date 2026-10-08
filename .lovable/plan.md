# Fix: late steer causes an accidental skip at song end

## What happened
A few seconds before a song ends, Crate starts the "hand-over": it grabs the current finish door (B) and its skip song (v), waits for the real end, then sends them to Spotify. Your steer arrived inside that window. The steer picked a new B and v, but the hand-over had already grabbed the old ones and fired them anyway. Crate's plan then said "new B", while Spotify played the old one. So Crate read the song as an unexpected change and jumped on, which sounded like an immediate skip.

Only a quick check of the code points to this. The step-by-step maze log is stored in your browser, so I couldn't read it from here. Step 1 confirms the cause.

## Rule: a "last-seconds lock"
Once the hand-over has started (about the last 10 s of a song), the doors for that song are frozen:
- Anything you steer then (a chat steer, a prompt or a search pick) is **not** applied to the ending song.
- Instead it's kept as a pending steer. As soon as the finish song is confirmed playing, it's applied to the new song's doors in the usual way: new B and v, with C staying queued.
- The maze log says: "Steer saved — applies after this hand-over".

Steers sent earlier in the song work exactly as now.

## Safety net inside the hand-over
Right before the hand-over sends anything to Spotify, it checks whether the planned doors changed since it started. A late steer that slipped past the lock would change them. If they did:
- If there's still about 3 s or more left, it uses the new B and v.
- If not, it sends the old B and v (the steer is held back as pending, see above). Crate also records the old B as the song now playing, so nothing gets taken for a skip.

## Steps
1. Add a temporary log line when a steer arrives during a hand-over, to confirm the cause on your next test.
2. Add the lock and the pending steer.
3. Add the pre-send check in the hand-over.
4. Add a rule line to the radio rules notes.

## Technical details
- `src/components/crate/radio-context.tsx`
  - `steerSession`: if `swapping.current === s.current.spotify_id` (hand-over in flight), store `{note, picks, opts}` in a new `pendingSteer` ref and return after a `note()`.
  - When the finish song is confirmed (the spot where `handledFor` / finish-seen is set and `committing` clears), if `pendingSteer` is set, call `steerRef.current(...)` with it and clear it. For prompt picks, rebuild `promptQueue` against the new current song.
  - `handOver`: snapshot `branches.current.key` and the B id at start. Right before `startSpotifyPlayback`, compare. If the doors changed and `end - now > 3_000`, swap to `upNextRef.current` and await `branches.current.finishSkip` (with timeout), else keep the old doors.
  - Clear `pendingSteer` on session end or reroot.
- `src/components/crate/AGENTS.md`: one rule line on the hand-over lock and pending steers.
- Verify with `bunx tsgo --noEmit`. Real Spotify behaviour needs your test: steer in the last ~10 s of a song.
