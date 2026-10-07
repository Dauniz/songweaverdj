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
- Sessions start via Start/search/prompt; compact search opens Memory; pause >90 s ends. Why: show the maze promptly.
- Alternative roads (src/lib/lenses.ts + alt-roads.ts): single-select, replace the default roads while on. Why: each road has its own picking and skip rules.
- Onboarding runs once per account (auth metadata flag). Why: first Studio visit only.
- Motion uses the shared timing/easing primitives in `src/lib/motion.ts`; product actions never wait for animation and reduced motion collapses to short fades. Why: motion stays coherent, accessible, and separate from playback state.

- Radio playback/queue rules live in src/components/crate/AGENTS.md. Why: scoped to radio-context.- Welcome guess (src/lib/welcome.functions.ts): on Studio entry with no session, Crate may suggest one prompt only when strong memories (anchors/history profile) plus 3+ same-weekday/time sessions back it (confidence >= 0.75); accept/decline is stored as an origin "welcome" hint, never a memory. Why: proactive but rare and accurate.
- "What Crate knows" page (src/lib/crate-knows.functions.ts): learned = memory_nodes origins cross_session/synthesis/listening; history = history_profile; everything else = unconfirmed hints; AI portrait uses only those memories. Why: highlight what Crate learned in sessions over what the import already shows.
- Spotify pill dot (src/components/crate/LibraryPanel.tsx): solid grey while no session is live; red the moment Crate can't reach Spotify during a session, green while it can. One universal wording in both the pill tooltip and the panel "Spotify connection status" line: "Spotify connection not found" (red), "Spotify connected" (green), "No session ongoing" (grey). Why: the dot means different things inside and outside a session, so the same three phrases always tell the truth, and the grey phrase names the actual state instead of echoing the section heading.

## AI models
- All text/chat AI calls use google/gemini-3.6-flash through the gateway chat-completions route (provider.chat); transcription keeps its dedicated speech model. Why: low running cost with good-enough quality, and no OpenAI/Anthropic dependency.
