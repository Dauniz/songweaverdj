# README: add a "bug found" section and an improvement proposal

Two real defects surfaced while auditing Songweaver's live Walrus Memory account. Both are reproducible and have hard evidence, so they read as a genuine bug report rather than a list of gripes. They go into `README.md` as two short subsections plus a proposal section, right after the existing "Integration notes (friction points & workarounds)" block and before "Architecture".

## What to add

### 1. Bug: a duplicated memory nobody can detect or delete

Same text, two blob IDs, one tester namespace:

```text
[session] Era-based radio worked well — listened through several tracks from the same period.
  Cv6aYSAplZhUPX2LC1PCkoINLwF5Fod9Z2viNDPyXws
  PnuhXKm3If7sRQ2-q-8BAEmCMdDWqYTWeETtB2iUgcE
```

Songweaver's mirror holds only one row for that text, so the second write came from a submit the app never saw as a separate memory. The duplicate is invisible from the outside yet doubles that memory's weight in every `recall()`. Nothing in the shipped SDK can remove it: `listNamespaces()` returns counts, `restore()` returns counters, and `forget(blobId)` exists only in the SDK's mock client. Root cause on our side: `rememberAsync()` accepts an `idempotencyKey` and Songweaver never passed one.

### 2. Bug: a memory stuck on `job:<id>` forever

A memory submitted on 2026-09-25 still shows `blob_id: "job:a0b6e630-…"` and status `pending` in the Inspector thirteen days later. Asked directly, `getRememberStatus("a0b6e630-…")` answers `done` with the real blob ID `V-E4Yy5FkBceyliBhYEQm9ev6Ld4U3D9dkhZmc3ETMk`, and `recall()` returns the text — Walrus finished the job long ago, only the local mirror is stale. Cause is Songweaver's own repair loop: `refreshMemories()` polls on a 6-second interval *only while the Memory Inspector is open*, so a job still running when the tab closes is never picked up again.

### 3. Proposal for an improvement

Three concrete asks, in priority order, each tied to the bug above:

1. **A `list()` for memories** — `listMemories(namespace, { cursor, limit })` returning `blob_id`, `text`, `created_at`. `listNamespaces()` already paginates with a cursor, so the shape exists; only the memory level is missing. The entire `memory_nodes` mirror table exists to compensate for this.
2. **`forget(blobId)` / `clear(namespace)` on the real client** — already modelled in the SDK's mock, so the API design is settled; a wrong, duplicated or privacy-sensitive memory is currently permanent.
3. **Duplicate protection by default** — content-hash idempotency inside `rememberAsync()`, or a `rememberIfNew()` that returns the existing blob ID instead of writing a second copy.

Plus a line on our own fix: repair pending jobs on app load and on a schedule, not only while a panel is visible.

## Accuracy fix to the existing note

Friction note 1 currently says MemWal has "no `list()` or pagination API". SDK 0.1.8 does ship `listNamespaces()` (cursor-paginated, with `memory_count` per namespace) and `restore(namespace, limit)`. The note will be sharpened to: neither returns the memories themselves — counts and repair counters only — and `recall()` stops at 100 results with no cursor even when asked for more, so enumerating a namespace is still impossible. This keeps the claim true and shows the SDK was actually read.

## Technical details

- File: `README.md` only. No code, styles or data changes.
- Placement: new `### Bug found …` subsections appended to the "Integration notes" block, then a `## Proposal for an improvement` section before `## Architecture`.
- Tone: same factual, first-person-plural voice as the existing integration notes; no marketing language.
- Evidence quoted verbatim from the live account: blob IDs, job ID, dates, and the 100-result recall cap.
- Nothing in the added text names a tester's account or email; namespaces are referenced by their user UUID prefix only where needed, and the plan will keep blob IDs (public by nature) rather than account identifiers.
- After writing, re-read the file to confirm heading levels and that the existing "What worked smoothly" paragraph stays intact.
