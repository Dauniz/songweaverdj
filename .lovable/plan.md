# Center and enlarge the Studio start screen

## Changes
- Keep the heading, supporting text, search and prompt box precisely centered within the available Chat area at every width and height.
- Keep “Picked for you” centered on the same visual axis and prevent it from drifting or being pushed off-screen on short iPhones and tablets.
- Make the central experience moderately larger: a wider input area, slightly larger heading and intro mark, and roomier suggestion rows and play controls.
- Use height-aware spacing so the larger layout scales back cleanly on short screens without clipping or horizontal scrolling.
- Preserve the current in-session centered state, prompt-playlist layout, colors, typefaces and all playback behavior.

## Technical details
- Replace the competing auto-margin placement in the empty Chat state with a stable responsive layout that gives the chat group and suggestion group explicit space.
- Keep shared width constraints and horizontal centering on both groups; increase their maximum width only where the available Chat column supports it.
- Apply compact height breakpoints for short phone/tablet viewports while retaining the larger default sizing.

## Verification
- Check the signed-in Studio at desktop, iPhone 390×844, short iPhone 375×667, tablet portrait 820×1180 and tablet landscape.
- Verify both pre-session and active-session states for centering, full visibility, readable sizing and no overlap or sideways scrolling.
