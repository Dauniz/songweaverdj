# Songweaver
https://songweaverdj.lovable.app

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

Songweaver has been used by three independent accounts, each storing their own memories on Walrus — Isac with 154 memories, Lukas with 33 and Anna with 11 — plus several smaller test accounts. The [multi-user showcase](docs/multi-user-showcase.md) lists each tester's namespace, memory count, listening span and sample blob IDs.

### Integration notes (friction points & workarounds)

The Walrus Memory relayer itself has been very reliable — at the time of writing, 200 memories stored with real `blob_id`s and only 1 still pending. But building Songweaver around it surfaced three real architectural gaps and two concrete bugs worth documenting:

1. **No `list()` for memories** — MemWal offers semantic `recall({ query, limit })`, `rememberAsync()`, and `listNamespaces()`. The last one paginates with a cursor and reports `memory_count` per namespace, but neither it nor `restore()` returns the memories themselves — counts and repair counters only — and `recall()` stops at 100 results with no cursor even when asked for more. There is no way to enumerate the memories in a namespace, so a memory cannot be shown, audited or deleted by ID. To build the Memory Inspector, Songweaver keeps the local `memory_nodes` mirror table; without it, an app can only query its memories blind.
2. **Asynchronous `rememberAsync()` with no completion event** — saving a memory returns a `job_id` immediately, not the final `blob_id`. The relayer takes time to SEAL-encrypt, embed and store the memory. Songweaver stores the memory locally as `blob_id: "job:<id>"` with status `pending`, then polls `getRememberStatus(jobId)` until the job completes and the permanent blob ID is swapped in. A webhook callback, a synchronous `remember()`, or a `job.waitForCompletion()` helper would remove this plumbing.
3. **Read-after-write latency** — because embedding and SEAL encryption happen in the background, a memory saved a moment ago does not yet appear in a subsequent `recall()`. When Crate plans the next song right after learning a preference, it reads both the live Walrus `recall()` and its local cache so there is no blind spot while the Walrus job processes.

What worked smoothly: per-user namespace isolation (`namespace: "crate-${userId}"` under one shared delegate key) cleanly prevented taste leakage between testers, and semantic `recall()` quality for vibes and listening preferences was accurate and useful in the DJ prompts.

### Bug found: a duplicated memory nobody can detect or delete

While auditing the live account, one tester namespace held the same memory twice under two different blob IDs:

```text
[session] Era-based radio worked well — listened through several tracks from the same period.
  Cv6aYSAplZhUPX2LC1PCkoINLwF5Fod9Z2viNDPyXws
  PnuhXKm3If7sRQ2-q-8BAEmCMdDWqYTWeETtB2iUgcE
```

Songweaver's mirror holds only one row for that text, so the second copy came from a submit the app never saw as a separate memory. The duplicate is invisible from the outside, yet it doubles that memory's weight in every `recall()` — and for a taste memory, weight is the whole point.

Nothing in the shipped SDK can find or remove it: `listNamespaces()` returns counts, `restore()` returns repair counters, `forget(blobId)` exists only in the SDK's mock client, and `recall()` cannot page past 100 results. A memory that is wrong, duplicated, or needs to disappear for privacy reasons is currently permanent.

The root cause is on our side — `rememberAsync()` accepts an `idempotencyKey` and Songweaver never passed one, so a retried write landed as a second blob. The gap is that nothing in the product lets you notice or undo the result.

### Bug found: a memory stuck on `job:<id>` forever

A memory submitted on 2026-09-25 still showed `blob_id: "job:a0b6e630-…"` and status `pending` in the Inspector thirteen days later. Asked directly, `getRememberStatus("a0b6e630-…")` answers `done` with the real blob ID `V-E4Yy5FkBceyliBhYEQm9ev6Ld4U3D9dkhZmc3ETMk`, and `recall()` returns the text — so Walrus had finished that job long ago and only the local mirror was stale.

The cause is Songweaver's own repair loop: `refreshMemories()` polls every 6 seconds, but only while the Memory Inspector is open, so a job still running when the tab closes is never picked up again. The underlying friction is that job state is only reachable by polling with the job ID — a client that loses or never stores that ID has no way to reconcile what it wrote with what is actually on Walrus.

## Proposal for an improvement

Both bugs above, and all three friction points, come down to one missing capability: a client cannot enumerate its own memories. Three concrete asks, in priority order:

1. **A `list()` for memories** — `listMemories(namespace, { cursor, limit })` returning `blob_id`, `text` and `created_at` per page. `listNamespaces()` already paginates with a cursor and reports `memory_count`, so the shape exists; only the memory level is missing. The whole `memory_nodes` mirror table in Songweaver exists to compensate for it, and with a `list()` it would no longer be needed.
2. **`forget(blobId)` and `clear(namespace)` on the real client** — already modelled in the SDK's mock client, so the API design is settled. Until they ship on the real one, a wrong, duplicated or privacy-sensitive memory is permanent, which is hard to square with a user asking an app to forget something about them.
3. **Duplicate protection by default** — content-hash idempotency inside `rememberAsync()`, or a `rememberIfNew()` that returns the existing blob ID instead of writing a second copy. Idempotency keys exist today but are opt-in, and the common failure is a caller that never thought to pass one.

The fixes on our side are smaller: repair pending jobs on app load and on a schedule instead of only while the Inspector is open, and pass an idempotency key on every write so a retried submit collapses onto the original job instead of creating a second blob.

---

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend | TanStack Start v1, React 19, Tailwind CSS v4, shadcn/ui |
| Server | TanStack server functions and server routes (edge runtime) |
| Database & auth | Lovable Cloud (Postgres with row-level security) |
| AI | Google Gemini 3.6 Flash via Lovable AI Gateway (chat, song picking, synthesis) — no OpenAI or Anthropic models |
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

Add `http://localhost:8080/api/public/spotify/callback` as a redirect URI in your Spotify app.

### Database setup

Create a Supabase project, then apply the migrations in `supabase/migrations` in order — either with the Supabase CLI (`supabase db push`) or by pasting each file into the SQL editor. Enable email authentication in the project's auth settings.

## Trying it out

The live app is at https://songweaverdj.lovable.app. Because the Spotify app runs in Development mode, syncing a real personal library requires your Spotify account to be whitelisted by the author (Spotify's 25-user development quota) — reach out to request access. Everyone else can use the **Try Demo Library** button on the login page, which works without any whitelist. A Spotify Premium account is needed for Connect playback.

---

## Using it

1. Sign in and connect Spotify.
2. (Optional) Sync your library and import your streaming history for Wormhole, Deep cuts and better picks.
3. Open Spotify on any device, then type a prompt, search for a song, or press **Start session** in Studio.
4. Finish or skip songs and watch the Maze react. Open the **Maze** tab to see the path and the Memory Inspector with everything Crate remembers.
