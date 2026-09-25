# Crate "Path Radio" — one song at a time, steered by listening

## The idea
Every session starts from one song: either one you click play on, or the first pick from your prompt. From there the radio picks **one song at a time**, like working through a maze. Each finished or skipped song decides which way it goes next. All your playlists count as one big merged library (each song appears once, but remembers every playlist and time period it came from).

## How the path works

```text
Seed song (Olivia Dean)
   |
   played through --> VIBE road: similar mood/setting (Joy Crookes)
                        |- played through --> keep going (chill Beyoncé, Sienna Rose, more Olivia Dean)
                        |- skipped        --> switch to ERA road
   ERA road: same playlist / same months as the last song you finished
                        |- played through --> stay in that playlist and era
                        |- skipped        --> try the other road, or a mix of both
   2 skips in a row --> a small, gentle prompt appears (see below)
```

- **Played through** (or past about 70%) means "yes, this road": the next song stays close to it.
- **Early skip** means "not this": the road changes. Vibe switches to era, era switches to vibe, and after that it widens the search.
- **Replay** keeps the current road; it only becomes a favorite across sessions (as now).
- Skipping the same artist twice drops them for the rest of the session (as now).
- The next song is always worked out ahead of time, so skipping is instant. It is worked out again the moment you finish or skip a song.

## Gentle steering chips (optional, never required)
- After 2 skips in a row, or every 20 minutes or so, a small card slides up above the player: *"Want to steer?"* with chips such as **Svenskt, Engelskt, UK, Nostalgi, Instrumental, Lugnare, Mer energi**.
- It disappears on its own after about 12 seconds and the music never stops. Ignoring it is fine.
- A tapped chip steers the rest of the session and shows as a small tag on the player. Tapping it again removes it.
- The player bar also keeps an always-visible chip button, so you can steer any time without waiting for the card.

## What you'll see
- The player shows which road it's on: "Following the vibe" or "Staying in 2019 · Favoriter of all time".
- Up next shows one song, not a batch of 8.
- The chat stays the place to start or restart a session. The radio runs by itself afterwards.

## Technical details
- New server function `nextPathTrack` in `radio.functions.ts`. Input: seed track, path history (last ~15 entries of `{trackId, outcome}`), current road (`vibe | era | mixed`), active chips, avoid-artists, excluded ids. Output: one track + road + a short "why".
- **Merged pool:** library rows are deduped by `spotify_id` in code; each unique song keeps a list of its `source_name` and `source_period` values.
- **Era road is plain code, not AI:** candidates come from the same playlist(s) as the last played-through song, then from ±2 months of its period, ranked by closeness and excluding played songs. This is fast and free.
- **Vibe road uses AI** (`openai/gpt-6-astra`) with a pre-filtered shortlist of about 300 candidates (dropping played, skipped and avoided songs), the seed and last liked songs, chips and Walrus memories. It returns a single code.
- **Road switching** is a small state machine on the client in `radio-context.tsx`: `consecutiveSkips`, the current road, and a prefetch of the next track that is invalidated on each outcome.
- The chip prompt is a new component, `SteerChips.tsx`, above `RadioPlayer`. Chips are saved to `listening_events` as a `steer` event, which needs a CHECK constraint migration, so they can become learned memories over time. Example: "picks Svenskt for dinner sessions".
- The existing `refillRadioQueue` batch refill is replaced by `nextPathTrack`. The steering text input is replaced by chips.
