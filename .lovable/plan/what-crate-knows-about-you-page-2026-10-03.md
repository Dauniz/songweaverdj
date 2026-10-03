# "What Crate knows about you" page

## What you'll see
- A new page, **What Crate knows**, for every signed-in user (not only admins). It's reached from a small link in the Studio header and from the Memory tab.
- It opens with a short portrait written by Crate in plain, warm language. For example: "You lean into sad songs on Wednesdays, want energy in the mornings, and drift toward Swedish music in summer."
- Below that are three sections, with the most important first:
  1. **Figured out by listening with you.** This is the highlight, styled as the strongest section. It holds things Crate learned only from hours of sessions together, for example "You usually skip songs with long intros before the vocals" or "Groovy beats keep you listening." Each item shows how many sessions back it up and when it was first noticed.
  2. **Your rhythms.** Day, time and season patterns ("Sad vibes on Wednesdays", "Energy in the mornings"), each marked as learned in sessions or seen in your history.
  3. **From your streaming history.** The baseline from your imported Spotify history, kept visibly smaller and labelled as "known before we met".
- Hints that haven't been confirmed yet (Feedbacker notes, steers, welcome answers) appear in a collapsed "Still testing" list. This keeps it honest about what's a guess.
- If Crate knows little yet, the page says so and suggests listening a few sessions.

## How it decides what's "learned by Crate"
- Learned in sessions: anchors (cross-session) and session-derived memories, i.e. everything that comes from listening events inside Songweaver.
- From history: the history profile, plus anything whose only support is the import.
- The portrait is written fresh from these memories when the page opens, then cached for the day so it's fast and cheap. It never invents things outside the saved memories.

## Technical details
- New route `src/routes/_authenticated/crate-knows.tsx` (all signed-in users; no admin check) with its own head metadata.
- New server function `getCrateKnows` in `src/lib/crate-knows.functions.ts` (requireSupabaseAuth): reads the user's `memory_nodes`, groups them by origin (`cross_session`, `synthesis` = learned; `history_profile` = history; `steer`, `welcome`, Feedbacker/chat = hints), counts sessions supporting each via `listening_events`, and asks the Lovable AI model for a 2–3 sentence portrait plus short themed headlines. Only these memories are used as input, and the result is cached per user per day in sessionStorage on the client.
- Header link in Studio + "See everything Crate knows" link at the top of MemoryInspector.
- Kinetic motion from `src/lib/motion.ts`; semantic tokens only.
- AGENTS.md rule for the page's source split (learned vs history vs hints).
