# Return to the steering screen when the prompt playlist ends

## What changes
- While Crate's 6-song prompt playlist is playing, the Chat tab keeps showing the conversation and the 6 cards, as today.
- The moment the playlist is over (song 6 finished) or left (a skip, your own Spotify pick, a road change or a steer), the Chat tab switches back to the normal live-session screen: "Want to steer your session?", the steering prompt box and the search bar.
- The music and maze are not touched — only what the Chat tab shows.
- If no session is live, nothing changes.

## Technical details
- radio-context: add a `promptPlaylistActive` boolean state, set true wherever `promptQueue.current` is assigned a list and false wherever it is cleared (single helper `setPromptQueue` so every exit path updates it). Expose it in the context value.
- MoodChat: take `setMessages` from `useChat`; an effect watches `promptPlaylistActive` going true → false while `sessionLive` and calls `setMessages([])`, so the existing empty live-session screen renders.
- Chat steering replies (steer_only) never start a playlist, so steering chats stay visible until the user leaves the tab or a playlist ends.
