# Refine Crate's memory tiers

Keep the existing tiers and sharpen them. Steer prompts become a new hint tier. The library sync still creates no memories.

## Tiers (strongest to weakest)

```text
1. Cross-session anchors    durable patterns across many sessions
2. History profile          from the streaming-history import (baseline)
3. Feedbacker notes         your words about a specific song
4. Steer insights (NEW)     what you asked Crate to steer toward, mid-session
5. Session observations     single-session hints
```

## Changes

1. **Save steers as insights.** Each mid-session steer (e.g. "More swedish please") is saved as a "Steer" insight in Walrus and shows in the Memory tab. Plain approvals ("I'm loving it") are saved as a short positive steer for that session. Near-duplicates within the same session are skipped.
2. **Steer insights shape song picks only as weak hints.** They are listed in their own section, below Feedbacker notes. The live steer in the current session still takes priority, as it does today.
3. **Turning insights into anchors.** When Crate looks for patterns across many sessions, it now also reads steer insights and Feedbacker notes. An anchor can be created only when the same direction shows up in 3 or more sessions **and** is backed by real listening (songs played through, not skipped). Words alone never create an anchor.
4. **Session observations feed anchors.** The cross-session pass now also reads the last 20 session observations, so it can promote patterns it has seen again and again. When an observation's pattern is promoted, Crate stops treating that observation as a separate hint, so the same point isn't counted twice.
5. **Memory tab labels.** Add a "Steer" label. Each item's label shows its tier, e.g. "Anchor · strongest", "Observation · hint".
6. **crate-info page.** Update the memory explanation to list these 5 tiers and say plainly that the library sync only fills your song library.

## Technical details

- New `memory_nodes.origin` value `steer` (text column, no schema change). It's saved through a new authed server function in `memory.functions.ts`, which radio-context's `steerSession` calls, kind `mood_trigger`, content `Steer (<date, part of day>): <note>`.
- `path.functions.ts` memory query adds `origin.eq.steer`. It takes the newest 6 into a "Steer requests (weaker hints)" block placed after the notes.
- `taste-synthesis.server.ts`, history scope (`cross`): load the newest steer, note and synthesis rows into the prompt as "Stated intents & prior observations". Add a prompt rule that a pattern can be promoted only with 3+ sessions of support and agreeing listening events. Reuse the existing duplicate check.
- `MemoryInspector.skillForMemory`: add `steer` and tier suffixes.
- Record in `src/components/crate/AGENTS.md` that steers persist as weak insights and that anchors need listening evidence.
