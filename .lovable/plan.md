# Keep finish hand-overs working when the page sleeps

## The problem
iPhones and iPads freeze Songweaver when its page is in the background, and the published site works the same way. If a song ends while the page is frozen, Crate never sends the finish song. Spotify then plays the skip song it already has lined up.

## What we'll build (only the essentials)
1. **Hand-over note when the page hides.** When the page goes to the background during a live session, the browser saves one short note to the backend: the current song, when it should end, and the finish song plus its skip song (B and v).
2. **A small backend helper.** A timed job runs once a minute and only does real work when a note exists. For each note ending within the next minute, it waits until the song ends, checks what Spotify is playing, and sends [B, v] only if the original song really finished. If the song was skipped or changed by hand, it does nothing.
3. **Rescue on return.** When you come back, the page reads the note's result. A finish the helper handled is logged as finished (not skipped), and the maze continues from B as normal. Then the note is deleted.
4. **Notes are cleared** when the page becomes visible again, when the session ends, and after 15 minutes, so nothing piles up.
5. **On/off switch.** One setting turns the helper off completely if costs are too high.

Nothing changes while the page is open. The usual in-page hand-over still does the work.

## Cost check
- Before turning it on, record the current running-cost baseline for this project.
- What it adds: one backend run per minute, about 1,440 a day. Each run is a single database read when no note exists. Real Spotify calls happen only for songs that end while a page is in the background. No AI calls are added.
- After a few days, compare usage against the baseline and report the difference. If it's too much, switch the helper off or remove it.

## Technical details
- New table `pending_handovers` (user_id, track_id, ends_at, b_uri, v_uri, status, created_at). RLS limits each user to their own rows. The helper uses the admin client.
- The client writes the note on `visibilitychange` → hidden, using `fetch` with `keepalive` so it survives the freeze. The note is upserted again whenever B or v changes while the page is hidden-pending.
- Server route `src/routes/api/public/handover-tick.ts`, called by pg_cron every minute with a shared secret header. It selects rows where `ends_at` falls within the next 60 s, sleeps until each end (it never holds a run open longer than about 55 s), checks `/me/player`, and sends play [B, v] using the server-side Spotify token refresh.
- radio-context reads the note result on visible and marks B as the finish (it bypasses the foreign-pick and skip logic). The rule goes into src/components/crate/AGENTS.md.
- Kill switch: an env flag `HANDOVER_HELPER=off`, plus unscheduling the cron.
- Limitation: Spotify reports position only roughly, so a handled finish may start up to about 1 s late.
