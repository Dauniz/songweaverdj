# Compact, more prominent chat

## Goal
Keep Crate’s current layout and visual language, but make the center conversation feel tighter, larger, and more intentional. Preserve the circled Walrus Memory receipt and the assistant’s closing sentence.

## Changes
- Keep the existing two-column song-card format, dark styling, controls, and interaction mechanics.
- Tighten gaps and padding between chat messages, result groups, song cards, the radio action, memory receipt, and closing sentence.
- Increase album artwork from its current 64px size and enlarge the play, favorite, skip, and Spotify-link icons while arranging those controls in a cleaner, denser row.
- Lift the visible conversation upward and give the transcript more usable height, while keeping deliberate empty space beneath the composer rather than stretching content to the bottom edge.
- Add a smooth, short page-entry sequence: conversation fades/slides in first, then song results, memory receipt, and composer. New assistant results use the same restrained reveal; reduced-motion users get no movement.
- Remove the fixed prompt chips such as “Late-night coding” and “Nostalgic drive.” Replace them with a small set of personalized suggestions derived from the user’s recent taste and session memories; tapping one still sends it immediately.
- Remove the entire era selector and its filter text from outgoing messages.
- Keep Deep cuts and its explanatory tooltip beside the composer.
- Keep the saved-memory row, its expandable details, and the assistant’s final text exactly within the conversation flow.

## Technical notes
- Update `MoodChat` for the denser transcript, entry animation, personalized suggestion query/rendering, removed era state, and simplified outgoing filters.
- Add a small authenticated server function that builds a few concise prompt suggestions from the user’s recent memory nodes, with safe defaults only when no useful memories exist.
- Update `TrackCard` sizing and control placement without changing play, Spotify, favorite, or skip behavior.
- Add reusable motion utilities in the global styles and respect `prefers-reduced-motion`.
- Verify the loaded conversation, personalized chips, Deep cuts, song controls, memory receipt, and desktop/mobile spacing in the live preview.
