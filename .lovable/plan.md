# Songweaver first-time onboarding

## What we’ll build

### 1. Studio setup guide
Show a lightweight, one-time walkthrough when someone first enters the Studio:
1. Highlight **Sync library** in the Spotify panel and explain that it imports liked songs and songs from playlists they created.
2. Highlight **Start session** in the header and explain that a session links Crate to live Spotify listening.
3. Highlight the main prompt area and explain that they can describe a vibe, search for a song, or simply start from what Spotify is already playing.

Each step will have **Next**, **Back**, and **Skip** controls, with a clear progress count. The guide will open a minimized Spotify panel when necessary and position itself safely on desktop and mobile.

### 2. Feedbacker introduction
The first time a listening session has a current song, show a separate short spotlight around **Feedbacker** in the Maze:
- Explain that a few words about how the song feels become a Walrus taste memory.
- Let the user dismiss it immediately or open Feedbacker directly.
- Show this only once per device, independently from the main setup guide.

### 3. Persistence and behavior
- Store completion locally on the device so returning users are not interrupted again.
- Do not block Spotify sync, session start, playback, chat, or navigation.
- If a highlighted control is unavailable, advance gracefully rather than trapping the user.
- Keep all onboarding visual-only; existing Spotify, session, and memory behavior remains unchanged.

## Technical details
- Add a small reusable spotlight overlay component using the existing Songweaver colors and button styles.
- Add stable onboarding targets to the Spotify sync button, session button, prompt area, and Feedbacker card.
- Coordinate the setup guide from the Studio layout and trigger the Feedbacker guide from active radio state.
- Respect reduced-motion preferences and keep the overlay keyboard accessible.
- Verify first visit, dismissal, persistence after reload, session-start Feedbacker timing, and desktop/mobile placement.
