# Showcase the three testers as real evidence

The brief asks participants to showcase "at least 3 different users" with "at least 10 memories stored for each user", backed by real evidence. Your live account clears that bar comfortably — Isac 154 memories, Lukas 33, Anna 11 on Walrus — but right now nothing in the repo proves it: the README has one sentence with stale numbers and no names, and the article only ever talks about your own memories. This plan fixes the repo side and hands you a paragraph for the article.

## What to build

### 1. A new evidence page: `docs/multi-user-showcase.md`

A short page with one table, every figure pulled from the live account:

| Tester | Walrus namespace | Memories on Walrus | First / last memory | Sample blob IDs |
| --- | --- | --- | --- | --- |
| Isac (author) | `crate-0ee1f758…` | 154 | 26 Sep → 7 Oct 2026 | `fjD6raPE…`, `xkBwzYem…` |
| Lukas | `crate-b95cb4eb…` | 33 | 27 Sep → 1 Oct 2026 | `_JYLc-mc…`, `QV7sib7F…` |
| Anna | `crate-36dda65a…` | 11 | 27 Sep → 5 Oct 2026 | `L4vbI-yl…`, `EiRkpGcx…` |

Plus two honest notes:
- **What the numbers are.** Counts come from Walrus Memory's own `listNamespaces()` report for each namespace, not from Songweaver's database. Songweaver's local mirror holds slightly fewer rows (143 / 32 / 11) — the gap is the duplicate-write bug already documented in the README, so the two pages agree with each other.
- **No memory text is published.** Blob IDs are opaque, so nobody can read what any tester listens to from this page. Names are first names only; emails and account identifiers stay out.

The page also states what each tester actually did — connected Spotify, ran sessions, prompted Crate in chat, finished and skipped songs — so the memories are shown as a product of use, not seeded test data.

### 2. Point the README at it

Replace the one stale "Multi-user showcase" sentence with the current counts and a link to the evidence page, so a judge sees the claim and the proof two clicks apart.

### 3. Article paragraph (yours to place and edit)

You write the article yourself, so I will not touch the draft. I will hand you a short paragraph in your own register — three named testers, their memory counts, the date span, and the line that the memories came from real listening rather than a demo script — for you to drop in near the existing "over one hundred memories" passage, which currently speaks only about you.

## Technical details

- New file `docs/multi-user-showcase.md`; edit only the "Multi-user showcase" paragraph in `README.md` (currently line 37). No app code, styles or data changes.
- Every number, date and blob ID is read from the live database and the live `listNamespaces()` call at build time, then written into the file as static text — nothing in the repo queries your account.
- Namespaces are shown abbreviated (first 8 characters of the user UUID) with the full value in the table, since the namespace is already visible to anyone with the account key and reveals nothing on its own.
- No email addresses, no Spotify account identifiers, no memory sentences in the table or anywhere in the repo.
- After writing, re-read both files to confirm the table renders as valid markdown and the README link resolves to the new file.
