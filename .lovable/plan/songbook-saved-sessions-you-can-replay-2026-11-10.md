# Songbook: saved sessions you can replay

## What the user gets
- A **Songbook** icon in the Studio's top-right corner (next to "What Crate knows"). Opens a Songbook page.
- **Save to Songbook**: during a live session (and in the end-session moment), a small "Save to Songbook" action asks for a **name** and **description** (e.g. "Work music" / "perfect for chill background music while working").
- **Songbook page**: a list of saved sessions in the same card style as the Studio's "Picked for you" picks: title, description underneath, a small **edit** (pencil) to rename/redescribe or delete, and a **play** button on the right.
- **No song list is shown.** You can't open an entry to browse its songs, which keeps all choosing with Crate.
- **Playing an entry** starts a new session that picks up where that session's maze left off: same road, side road and last song as the starting point. Crate keeps building new doors from there, and **every few songs it slips one of the saved songs back in** as the finish door. It never repeats a recent one and never adds them in a row.
- A short **tooltip/intro line** at the top of the Songbook page: "Save sessions you love. Press play and Crate picks up the vibe and keeps it going. No browsing needed."
- **Onboarding**: a new tour step pointing at the Songbook icon: "Save a session you love to your Songbook, then replay its vibe any time."

## Rules
- Saved songs = songs actually played through in that session (finished, not skipped), in order, capped at 100.
- A saved entry is updated only by edit. Replaying it doesn't overwrite it (a "Save again" can create a new entry later if wanted).
- Playback rules (doors, finish/skip handover, Spotify only during sessions) stay as they are. The Songbook only feeds the starting point and occasional finish-door picks.
- Songbook entries are not Walrus memories. They stay private to each account.

## Technical details
- New table `songbook_entries` (id, user_id, name, description, tracks jsonb, resume_state jsonb with road/lens/last track, created_at, updated_at). Grants + RLS limit access to your own rows.
- `src/lib/songbook.functions.ts`: list/save/update/delete via `requireSupabaseAuth`.
- `radio-context.tsx`: track finished songs per session; add `saveToSongbook(name, desc)` and `playSongbook(entry)`, which reuses the resume path with the entry's state. Add a `songbookPool` ref: during door planning, every 4–6 songs it fills the finish door with an unplayed pool song that passes existing pick rules.
- Route `src/routes/_authenticated/songbook.tsx` (with head metadata), header icon in `studio.tsx`, a save dialog in `SessionControl.tsx`, and an onboarding step in `OnboardingTour.tsx`.
- Tests: pool interleave spacing and no-repeat rule. Record the structure rule in AGENTS.md.
