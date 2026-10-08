# Multi-user showcase

The Walrus Sessions 8 brief asks participants to showcase at least 3 different users, each with at least 10 memories stored. Songweaver has three, and the numbers below come from the live account rather than a demo script.

| Tester | Walrus namespace | Memories on Walrus | First / last memory | Sample blob IDs |
| --- | --- | --- | --- | --- |
| Isac (author) | `crate-0ee1f758-5701-4ceb-b900-8b5d48550a77` | 154 | 26 Sep → 7 Oct 2026 | `fjD6raPEvgvQX8oqh-vhIIYA6_hMcWwWo8oUiPareoc`, `xkBwzYemKfkvEA4C1B_Za3jI2wn-r5JE0gL9PY7nSzM` |
| Lukas | `crate-b95cb4eb-12a7-42a3-ad79-f489e4ac2581` | 33 | 27 Sep → 1 Oct 2026 | `_JYLc-mcM85O3k30sPGX3lojgMeXzdOQH6C7ndFGBm8`, `QV7sib7FPBf-QfX6vdBQ5RsUINYmehdpP9DUS36VENc` |
| Anna | `crate-36dda65a-1eff-4668-b793-a1265e19ffe0` | 11 | 27 Sep → 5 Oct 2026 | `L4vbI-yliQazGZXrVffD6wBhQ47Ygdj4dFSm5LA4iDo`, `EiRkpGcx1fJKKP3g-IK7setbiDytbAB6T754P4fuX9I` |

Each tester connected their own Spotify account, started sessions by prompt or by song, talked to Crate in chat, and finished or skipped real songs. Every memory in the table was written by Crate while those sessions ran — nothing here was seeded, imported or hand-written for the submission.

## What the numbers are

The memory counts come from Walrus Memory's own `listNamespaces()` report for each namespace, not from Songweaver's database, so they describe what is actually stored on Walrus. Songweaver's local mirror holds slightly fewer rows per tester (143, 32 and 11) — the gap is the duplicate-write bug documented in the README's integration notes, which is exactly why the two figures differ.

The blob IDs are the first and last memory each tester has on Walrus, so the date span and the storage can be checked against the same account.

## What is not published

No memory text appears here. Blob IDs are opaque, so this page cannot be used to read what any tester listens to. Testers are named by first name only; emails, Spotify account identifiers and the shared delegate key stay out of the repository.
