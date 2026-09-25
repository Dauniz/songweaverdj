# Crate: Vibe Radio + Passive Taste Learning

## Goal
Turn the chat from one-shot card picks into a continuous "vibe radio": you prompt a song or mood, Crate keeps playing matching tracks, and it learns your taste from what you *do* — not from like/skip buttons.

## How memory works today (no change)
- The AI saves short facts (taste, genre, mood trigger, skipped, session) to Walrus Memory via `save_memory`; a local mirror feeds the Memory Inspector.
- On each message, memories are recalled and injected into the AI's context.

## What changes

### 1. Vibe Radio mode (continuous play)
- New "Start radio" action on any recommendation batch (or from a prompt like "play something like X").
- A queue-based player bar at the bottom: current track, album art, next up. When a track ends (or is skipped), the next queued track starts; when the queue runs low (< 3 tracks), the app silently asks the AI for more tracks matching the session's mode.
- **Session mode detection**: the AI classifies the opening prompt once per session:
  - `era` mode — prompt mentions nostalgia, a year, "like when I was...", or a specific song → keep pulling tracks from the same period/playlists as the seed song.
  - `vibe` mode — prompt mentions a setting or feeling (dinner, sad, focus, gym) → keep pulling tracks that match the mood regardless of era.
  - Mode is shown as a small chip on the player ("Era: 2019" / "Vibe: late-night dinner") and can be switched manually.

### 2. Passive feedback signals (replace buttons as the main signal)
Track listening behavior automatically and save it as memory:
- **Played through** (>80% of preview/track) → positive signal; after ~3 play-throughs of similar tracks, save a taste memory ("loves early-2010s indie for focus").
- **Skipped early** (<30%) → soft negative; 2 early skips of the same track → "skipped" memory; 3 early skips of same artist/genre in a session → avoid for the rest of the session.
- **Replayed / went back** → strong positive, save immediately as a favorite.
- **Queue accepted without skips for a while** → session memory that the current mode is working.
- Keep the existing Heart/Skip buttons, but demote them to small icons — explicit feedback still works, it's just no longer required.

### 3. Natural-language steering
- A small input on the player bar ("more like this", "sadder", "newer") that steers the queue without leaving radio mode; each steering message can also produce a memory when it reveals something durable.

### 4. Memory Inspector additions
- Show signal-derived memories with their origin (e.g. "learned from listening" vs "you said") so the learning is transparent and demo-able for judges.

## Technical notes
- New `listening_events` table (user_id, track_id, event: play_through/early_skip/replay, session_id, mode) with RLS + grants; aggregated into `memory_nodes`/Walrus by a server function, not one memory per event.
- Radio queue state lives client-side; refills call a new `refill_queue` tool/server fn with the session mode + recent feedback summary.
- Prompt classification happens in the existing chat server fn (one extra structured field), no extra model call.
- Player uses existing 30s Spotify preview URLs; tracks without previews are auto-skipped in radio mode.

## Out of scope
- Real Spotify playback SDK (full songs) — previews only for the hackathon.
