# Prompt playlist on the steering screen

## What changes
- After you start a session with a prompt, the Chat tab shows the normal live-session steering screen ("Want to steer your session?", the text, search bar and prompt box), with Crate's 6-song playlist shown above it at the top.
- The 6 song cards are display-only: no play buttons, clicking does nothing. The first song still starts automatically, as today.
- When the playlist is over (song 6 finished) or left (a skip, your own Spotify pick, a road change or a steer), the 6 cards disappear and only the steering screen remains.
- The music and maze are not touched — only what the Chat tab shows. Before a session, the chat works as today.

## Technical details
- radio-context: add `promptPlaylist` state ({ title, tracks } | null) set wherever `promptQueue.current` gets a list and cleared wherever it is nulled (one `setPromptQueue` helper covers every exit path). Expose it in the context.
- MoodChat: once a recommend_tracks answer auto-starts the radio, clear the chat (`setMessages([])`) so the empty live-session screen renders; render a compact playlist block (vibe title + 6 TrackCards in a grid) above the heading while `promptPlaylist` is set. Steer replies (steer_only) apply as today and the screen returns to the steering view after they finish.
- TrackCard: make `onPlay` optional; without it, hide the play button and click handler.
- Add both items to roadmap.md when building.
