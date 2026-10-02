# Chat-based steering + crate-info edits

Replace the steering popup with steering through the chat, and update the "How Crate uses Walrus" page.

## 1. Steering moves from popup to chat

**Removed:** the SteerChips popup entirely — the periodic ~20-minute offer, the popup after two skips in a row, `SteerChips.tsx` and `steer-chips.ts`, and the `askSteer`/`dismissSteer`/`toggleChip` plumbing in `radio-context.tsx`. Chat and music behavior otherwise unchanged.

**New: mid-session chat steering.** When a session is live, any chat prompt steers instead of starting over:

- Crate's reply stays in chat ("Steering toward more rap — the next doors will lean that way"), no new starting song, no interruption of the current track.
- The steer direction is stored on the session (`steerNote`) and passed to the door picker on every future pick, so the maze drifts onto the steered path from the next junctions onward.
- Doors updated: **B** (finish door), **v** (B's skip door), **w** (C's skip door) are re-scouted with the steer in mind. **C (the skip door) is kept untouched** — it is already queued in Spotify, so replacing it could cause a sound glitch. The current song is never changed.
- "I'm loving it" → Crate stays on track: no doors change, a warm reply, and the moment is logged for Walrus as positive steering signal.
- **Steering never engages the six-track prompt queue** — that queue is only for a prompt that starts a session. A mid-session steer sets the new doors and hands back to the normal maze rules.
- Search results and picking a song straight in Spotify still re-root the maze exactly as today.

**Composer text.** While a session is live, the chat input placeholder becomes:
`Not feeling it? Tell Crate to steer the session in any direction. For example "More rap", "Less energy", "More nostalgia"` (quotes escaped). With no session, today's placeholder stays.

## 2. crate-info page edits (`src/routes/crate-info.tsx`)

- **Skills: remove "Deep cuts"** — already described under Alternative roads.
- **Feedbacker reword** — no longer "the sharpest signal"; now a valuable hint about the song playing right now, example becomes `"Gymnasiet, sommar, Thailand"`, and it "ties a feeling, event or location to a track forever, and Walrus carries it into every future session."
- **Steer skill reword** to describe chat steering (no more chips/popups): while a song plays you can steer in chat — "More rap", "Less energy", "More nostalgia" re-pick the songs waiting behind the doors without touching the song playing now; saying you love it keeps the path and teaches Crate what's working.
- **Maze section:** the line "send a new prompt mid-session and Crate re-plans the maze from that song" is updated — a chat prompt now steers the upcoming doors; searching or picking in Spotify still re-roots from that song.

## Technical details

- `src/lib/chat.server.ts` — `recommend_tracks` gains `steer_only` (bool) and `steer_note` (string) with `picks` optional when steering; system prompt teaches Crate: when the client marks the session live, direction messages return `steer_only: true` with a distilled `steer_note` (picks optional), approval messages return `steer_only: true` with no picks; a fresh prompt still returns picks as today.
- `src/components/crate/MoodChat.tsx` — `send()` appends a "(Session is live — steer instead of restarting)" marker so the model knows; the auto-start effect calls a new `steerSession` from the radio context when a session is active; placeholder switches on session state.
- `src/components/crate/radio-context.tsx` — new `steerSession(note, picks)`: sets `steerNote`, logs a steer event, replaces B with the first playable pick (Crate's own reason follows it), invalidates only B/v/w branches while preserving C, and re-scouts the missing ones; it never writes `promptQueue`. `steerNote` is cleared on start/stop and included in the session summary taste synthesis reads.
- `src/lib/path.functions.ts` — input schema gains `steerNote`; the picker prompt gains "Steering instruction from the listener (must respect): …"; the instant ERA path now also routes through the AI when a steer note is active (so the instruction is honored).
- Route-level: `/crate-info` page text only; no mechanics, motion, or layout changes elsewhere.

## Follow-up when approved

- Record the steering change and the six-track-queue exclusion in `roadmap.md` and in `src/components/crate/AGENTS.md` (radio playback rules: chat steering replaces the chip popup; promptQueue is prompt-start-only).
