# Move "Let Crate reflect" into the Walrus Memory header

The "See everything Crate knows" link in the Walrus Memory panel opens the same page as the brain icon in the top bar, so it is a duplicate. Remove it and put the "Let Crate reflect" action in its place, styled as the one obvious button in that panel.

## What changes

1. **Header of the Walrus Memory panel** — the link is deleted. In its spot sits the "Let Crate reflect" button: filled in the brand colour (the same bright green as the active tab pill), with the sparkle icon, sized small so it still fits the narrow panel. While it runs it greys out and reads "Crate is reflecting…".

2. **Old spot removed** — the plain text version of the button that currently sits under "Show Walrus log" is taken away, so the action only exists once.

3. **Result message stays nearby** — the short reply ("3 new insights written to Walrus", or "Nothing new to conclude yet — listen a little more") now appears as a thin line directly under the header, right below the button that triggered it, and fades after 6 seconds as it does today.

4. **Everything else untouched** — the brain icon in the top bar still opens "What Crate knows", "How Crate uses Walrus" and the admin-only "Reset Walrus log" stay at the bottom, and the reflect logic itself is not modified.

```text
before                          after
+----------------------------+  +----------------------------+
| (i) Walrus Memory   See -> |  | (i) Walrus Memory  (*) Let |
|                            |  |      Crate reflect         |
|  ...maze, chips...         |  |  <- result line appears    |
|  Show Walrus log           |  |     here, under header     |
|  * Let Crate reflect       |  |  ...maze, chips...         |
+----------------------------+  |  Show Walrus log           |
                                +----------------------------+
```

## How it gets verified

- Typecheck and the build log must come back clean.
- Signed-in checks in the preview at: desktop with no session (panel at its narrowest, 320px), desktop mid-session (panel wider), tablet, and iPhone. Confirms the button sits on one line without pushing the "Walrus Memory" title out, and that clicking it shows the result line.
- No Spotify playback is needed to check this change.

## Technical details

- File: `src/components/crate/MemoryInspector.tsx` only.
- The button reuses the existing `reflect` server function call and its `reflecting` / `reflectMsg` state — only the markup and placement move.
- Styled with the project's `Button` component (`variant="default"`, `size="xs"`) so it uses the existing colour tokens instead of a hardcoded colour.
- The `AnimatePresence` block that renders `reflectMsg` moves from the body to just under the header row; the header's bottom border stays above it so the panel still reads as one block.
- The `Link` import stays — it is still used for the "How Crate uses Walrus" footer link.
- The onboarding tour does not point at the removed link, so no tour steps need updating.
