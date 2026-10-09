# Make the memory counters in the Maze tab understandable

## Problem
The chips above the Walrus log ("Mood trigger · 15", "Genre · 3", "Taste · 22") count stored memories by type, but the labels explain nothing. Only Mood trigger has a "?" tooltip; Taste and Genre have none.

## Changes (all in `src/components/crate/MemoryInspector.tsx`)

1. **Rename the labels to plain words:**
   - `Taste` → **What you like**
   - `Mood trigger` → **Feelings tied to songs**
   - `Genre` → **Genres**

2. **Give every chip a "?" tooltip** (reusing the existing Mood trigger tooltip pattern), one short sentence each:
   - **What you like** — "Things Crate has concluded about your taste from how you listen. These shape every song he picks."
   - **Feelings tied to songs** — keep the existing tooltip text.
   - **Genres** — "Genres Crate has noticed you lean toward or away from, used when he picks songs."

3. Counts and chip colors stay as they are; no logic changes.

## Technical notes
- Edit `KIND_LABEL` and add entries to a shared tooltip-text map next to it; render the tooltip button for every kind, not just `mood_trigger`.
