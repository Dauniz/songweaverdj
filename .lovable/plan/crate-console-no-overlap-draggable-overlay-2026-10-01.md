# Crate console: no overlap + draggable overlay

Visual/layout only. No Crate mechanics, logging or Spotify behavior changes.

## What you'll see
1. **Collapsed:** the "Crate console" bar always sits fully above the bottom bar ("How Crate uses Walrus" / "Reset Walrus log"), never on top of its text — and the Walrus Memory title / maze never overlap either.
2. **Expanded:** the console opens as a panel layered on top of the Walrus tab (maze, current song and Door debug stay in place underneath instead of being squeezed).
3. **Drag to resize:** a small grab handle at the top edge of the open console. Drag up to make it taller (up past Door debug and the current song, up to just below the Walrus Memory title), drag down to make it smaller. Works with mouse and touch. The chosen height is remembered on the device.

## Technical details
- `MemoryInspector.tsx`: make the tab container `relative`; the maze/DoorDebug/log area always keeps `flex-1` (no longer shrinks when console opens). Collapsed console header stays a normal `shrink-0` row between content and footer, so footer never overlaps.
- `PathMaze.tsx` `CrateConsole`: when expanded, render the panel `absolute inset-x-0` anchored to the top of the footer (bottom = footer height), `z-20`, solid `bg-background` + border/shadow, height from state.
- Add a pointer-events drag handle (`onPointerDown` + `setPointerCapture`, `touch-action: none`); height clamped between ~160 px and container height minus header; persisted to localStorage (`crate-console-height`). Existing open/close animation adapted to animate height.
- Verify at desktop, tablet and iPhone widths in Playwright with a signed-in session.
