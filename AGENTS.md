<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Crate architecture
- Chat streams via server route `/api/chat` (src/lib/chat.server.ts) with bearer auth and persists to `chat_messages`, but Studio always mounts a fresh visible chat. Why: each visit starts clean while durable taste continuity comes from Walrus Memory.
- Voice prompts capture complete WAV audio in the browser and stream transcription through authenticated `/api/transcribe` using the Lovable AI Gateway. Why: reliable cross-browser audio while keeping credentials server-side.
- Walrus Memory (MemWal SDK) is the source of truth for taste memories; `memory_nodes` is a local mirror for the Inspector UI, with `blob_id` = `job:<id>` until the Walrus job finishes. Why: MemWal has no list API.
- Spotify uses custom OAuth (no connector exists); tokens live in `spotify_connections`, service-role only, callback at `/api/public/spotify/callback`. Why: keep tokens off the client.
- Radio picks one song at a time via `nextPathTrack` (src/lib/path.functions.ts) over a library merged by `spotify_id`; era road is plain code, vibe/mixed roads use AI; the client prefetches both the "played" and "skipped" branches. Why: instant skips and a maze-like path driven by listening.
- Radio playback uses server-side Spotify Connect commands and observes the active Spotify device; Crate renders no audio player. Why: listening stays in Spotify while Crate controls the path without exposing OAuth tokens.
