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

## Songweaver architecture
- Chat streams through authenticated `/api/chat` and persists, but Studio opens a fresh visible chat. Why: Walrus carries taste continuity.
- Voice prompts capture WAV in-browser and transcribe through authenticated `/api/transcribe`. Why: cross-browser reliability and private credentials.
- Walrus Memory (MemWal SDK) is the source of truth for taste memories; `memory_nodes` is a local mirror for the Inspector UI, with `blob_id` = `job:<id>` until the Walrus job finishes. Why: MemWal has no list API.
- Spotify uses custom OAuth; tokens stay server-only. iOS authorizes in the same tab and returns to Studio; desktop uses a popup with fallback. Why: Safari blocks delayed popups.
- Radio picks one song at a time via `nextPathTrack` (src/lib/path.functions.ts) over a library merged by `spotify_id`; era road is plain code, vibe/mixed roads use AI; the client prefetches both the "played" and "skipped" branches. Why: instant skips and a maze-like path driven by listening.
- Crate is Songweaver's AI companion; product-facing branding uses Songweaver while assistant and DJ language uses Crate. Why: the product and its AI have distinct identities.
- Radio playback uses server-side Spotify Connect commands and observes the active Spotify device; Songweaver renders no audio player. Why: listening stays in Spotify while Crate controls the path without exposing OAuth tokens.
- Sessions start only via Start, search or prompt; detours replan via `rerootTo`; pause >90 s ends. Why: predictable, fast.
- Spotify holds `[current, skip]`; both doors' own skips are pre-planned (landing plan, `finishSkip`) and sent as a pair on finish/landing; Spotify-started songs are re-sent once with their skip door. Why: Spotify never runs dry or plays the wrong door.
- Side roads (src/lib/lenses.ts): single-select; Wormhole filters the pool, Scene/Wave/Texture are DJ prompt rules. Why: paths without breaking the maze.
- Onboarding runs once per account (auth metadata flag). Why: first Studio visit only.
