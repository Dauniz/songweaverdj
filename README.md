# Songweaver

Songweaver is a personal music rediscovery companion. Its AI DJ, **Crate**, turns moods, prompts and your real listening behaviour into a living path through your own Spotify library — one song at a time — and remembers your taste across sessions with **Walrus Memory**.

Built for **Walrus Session 8: Chatbots That Remember**.

---

## What it does

- **Studio chat** — describe a mood, a moment or a memory ("rainy Sunday, early 2000s indie"). Crate answers with 6 picks from your own library that play in order.
- **The Maze (path radio)** — after the prompt, Crate keeps steering. Every song has two doors lined up in advance:
  - **Finish door** — where you go if you listen to the end.
  - **Skip door** — where you go if you skip.
- **Default roads** — Vibe Road, Era Road and New Angle. Skips in a row move you along a ladder: 1 skip stays on the road, 2–3 switch road, 4 opens a New Angle.
- **Alternative roads** — Wormhole (songs you keep returning to over the years), Texture, Scene and Deep cuts. When one is on, it replaces the default roads and uses its own rules.
- **Spotify Connect playback** — music plays in your own Spotify app; Songweaver controls the path, it doesn't play audio itself.
- **Streaming history import** — import your Spotify extended streaming history (.json / .zip) for play counts, plays per year and forgotten favourites.
- **Memory Inspector** — see every taste memory Crate has stored, with its Walrus blob ID.

---

## How Songweaver uses Walrus Memory

Walrus Memory (via the MemWal SDK, `@mysten-incubation/memwal`) is the **source of truth for taste**.

1. **Remember** — Crate writes memories when it learns something: listening patterns from imported history, synthesized taste summaries, what you finish and what you skip, and preferences from chat.
2. **Recall** — before picking songs or answering in chat, Crate runs a semantic `recall()` against your memories so every new session starts with your taste, even though each Studio chat opens fresh.
3. **Per-user isolation** — one server-side delegate key, with each user's memories namespaced by account, so listeners never see each other's taste.
4. **Verification** — the Memory Inspector shows each memory and its Walrus `blob_id`. While a write is still being finalized it shows `job:<id>`, then switches to the real blob ID.

Because MemWal offers semantic recall but no list API, Songweaver keeps a local mirror table (`memory_nodes`) purely so the Inspector can show memories in order. Walrus remains the source of truth.

### Multi-user showcase

Songweaver has been used by multiple independent accounts, each storing their own memories on Walrus (at time of writing: users with 124, 32 and 10 stored memories, plus several smaller testers).

### Integration notes (friction points & workarounds)

The Walrus Memory relayer itself has been very reliable — at the time of writing, 183 memories stored with real `blob_id`s and only 1 pending. But building Songweaver around it surfaced three real architectural gaps worth documenting:

1. **No `list()` or pagination API** — MemWal only offers semantic `recall({ query, limit })` and `rememberAsync()`. There is no way to enumerate or paginate all memories stored in a namespace, so a memory cannot be shown, audited or deleted by ID. To build the Memory Inspector, Songweaver keeps the local `memory_nodes` mirror table; without it, an app can only query its memories blind.
2. **Asynchronous `rememberAsync()` with no completion event** — saving a memory returns a `job_id` immediately, not the final `blob_id`. The relayer takes time to SEAL-encrypt, embed and store the memory. Songweaver stores the memory locally as `blob_id: "job:<id>"` with status `pending`, then polls `getRememberStatus(jobId)` until the job completes and the permanent blob ID is swapped in. A webhook callback, a synchronous `remember()`, or a `job.waitForCompletion()` helper would remove this plumbing.
3. **Read-after-write latency** — because embedding and SEAL encryption happen in the background, a memory saved a moment ago does not yet appear in a subsequent `recall()`. When Crate plans the next song right after learning a preference, it reads both the live Walrus `recall()` and its local cache so there is no blind spot while the Walrus job processes.

What worked smoothly: per-user namespace isolation (`namespace: "crate-${userId}"` under one shared delegate key) cleanly prevented taste leakage between testers, and semantic `recall()` quality for vibes and listening preferences was accurate and useful in the DJ prompts.

---

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend | TanStack Start v1, React 19, Tailwind CSS v4, shadcn/ui |
| Server | TanStack server functions and server routes (edge runtime) |
| Database & auth | Lovable Cloud (Postgres with row-level security) |
| AI | Lovable AI Gateway (chat, song picking, transcription) |
| Memory | Walrus Memory via MemWal SDK |
| Music | Spotify Web API + Spotify Connect (custom OAuth, tokens server-only) |

Key files:

- `src/lib/memwal.server.ts` — Walrus Memory client (remember / recall)
- `src/lib/memory.functions.ts` — memory server functions and Inspector data
- `src/lib/path.functions.ts` — Crate's next-song picking (`nextPathTrack`)
- `src/lib/alt-roads.ts` — alternative road rules
- `src/components/crate/radio-context.tsx` — the session engine (doors, skips, Spotify sync)
- `src/routes/api/chat.ts` — streaming chat with Crate

---

## Running locally

Requirements: Node.js 20+ (or Bun), a Spotify developer app, a MemWal account.

```sh
git clone https://github.com/<your-username>/Songweaver.git
cd Songweaver
npm install
npm run dev
```

### Environment variables

Create a `.env` file with:

```sh
# Database / auth (Supabase-compatible)
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Walrus Memory (from https://memory.walrus.xyz)
MEMWAL_ACCOUNT_ID=
MEMWAL_PRIVATE_KEY=
MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz

# Spotify (from https://developer.spotify.com/dashboard)
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

# AI gateway
LOVABLE_API_KEY=

# Scheduled jobs
LOVABLE_CRON_SECRET=
```

Add `http://localhost:8080/api/public/spotify/callback` as a redirect URI in your Spotify app. Database migrations live in `supabase/migrations`.

---

## Using it

1. Sign in and connect Spotify.
2. (Optional) Sync your library and import your streaming history for Wormhole, Deep cuts and better picks.
3. Open Spotify on any device, then type a prompt or press **Start session** in Studio.
4. Finish or skip songs and watch the Maze react. Open the Memory Inspector to see what Crate remembers.
