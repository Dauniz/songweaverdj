# Fresh Studio Chat

## What will change
- Open the center studio chat as a fresh session every time the Studio is entered, without deleting or changing Walrus Memory.
- Keep two personalized starting suggestions above the message box, based on saved taste and session memories.
- Move **Deep cuts** out of the message box and into the same slim suggestion row highlighted in the annotation.
- Make the message box, placeholder, chat copy, and suggestion controls slightly larger and more polished while keeping the current visual style and compact layout.

## Technical details
- Stop loading saved `chat_messages` into the Studio view; new messages can still be used during the current visit and durable preferences continue through `memory_nodes` / Walrus Memory.
- Preserve all existing Spotify playback, radio path, memory saving, and Memory Inspector behavior.
- Verify the empty entry state and populated chat at desktop and mobile sizes.
