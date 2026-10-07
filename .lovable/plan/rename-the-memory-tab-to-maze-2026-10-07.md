# Rename the "memory" tab to "Maze"

On phone and tablet, the Studio's top switcher shows "chat" and "memory". The second tab gets the label "Maze". Nothing else changes: same content, same behavior, and the onboarding tour still opens that tab.

## Technical details
- `src/routes/_authenticated/studio.tsx`: render a display label map (`{ chat: "chat", memory: "maze" }`, still capitalized by the existing class) instead of `{t}` at line 105. The internal `"memory"` tab key stays the same, so OnboardingTour, search selection and MemoryInspector are unaffected.
