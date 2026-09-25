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
- Chat streams via server route `/api/chat` (src/lib/chat.server.ts) with bearer auth; one running conversation persisted in `chat_messages`. Why: AI SDK UI-message streaming needs a raw Response.
- Walrus Memory (MemWal SDK) is the source of truth for taste memories; `memory_nodes` is a local mirror for the Inspector UI, with `blob_id` = `job:<id>` until the Walrus job finishes. Why: MemWal has no list API.
- Spotify uses custom OAuth (no connector exists); tokens live in `spotify_connections`, service-role only, callback at `/api/public/spotify/callback`. Why: keep tokens off the client.
