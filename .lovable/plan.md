# Side roads rework: Texture, Deep cuts and Scene become their own roads

## What changes for you
- **Wave is removed.** You can't pick it anymore, and a saved session that used it resumes with no side road.
- **A side road takes over the maze.** While one is on, Crate stops using Vibe Road and Era Road. He still prepares B, v, C and w ahead of time. Finishing a song keeps you on the side road.
- **Wormhole** is not part of this change and works as it does today. Tell me if you want it reworked too.
- **Turning a side road off** goes back to the normal Vibe/Era maze, from the song that's playing. The ~1.2 s misclick buffer stays.
- **Small shortlist:** for every door, Crate first narrows your whole library down to about 15 relevant songs in code, then the AI picks from those. That keeps running costs low.

## Texture
- **Finish:** a song with the same texture (piano stays piano, acoustic stays acoustic, electronic stays electronic).
- **1 skip:** another song with the same texture.
- **2 skips in a row:** a new texture, for example acoustic to electronic. The count starts over, so every 2 skips gives a new texture.
- No New Angle.
- Crate knows the current texture and shows it on the door, for example "Texture · acoustic".

## Deep cuts
- **Which songs count:** streamed at least 15 times in total, played 3 times or fewer in the last year, and never played in the last year as a regular favorite. This needs your imported history. Without it, Crate falls back to songs saved over a year ago that sit in only one playlist (today's rule), and the Crate console says so.
- **Finish:** another deep cut from the same era.
- **1 skip:** another deep cut from the same era.
- **2 skips in a row:** a new era, still more than a year back. Every 2 skips gives a new era.
- No New Angle.

## Scene
Crate picks an **original artist**: the artist of the song playing when you turn Scene on.
- **Finish:** a song by the original artist, or one of their collaborators. Featured artists are allowed too.
- **1 skip:** if the skipped song was by a featured artist, Crate goes back to the original artist. Otherwise he plays another song by the original artist. If there isn't one left, he picks the collaborator they share the most songs with.
- **2 skips:** a featured artist of the original artist. Artists featured on several of their songs come first.
- **3 skips:** a different featured artist.
- **4 skips:** New Angle. Crate picks a new original artist, from the same regional scene if possible (same genre tags and country/scene words).
- **Limit:** your library and Spotify know who sings on a song, but not producers or directors. "Collaborators" means artists credited together on the same songs in your library.

## Skip rules that still apply
Songs heard in the last 50 are left out. Artists cool down after a skip and are blocked after 5 skips (on Scene, the original artist is never cooled or blocked). The early door checks (DOOR CHECK) and "never swap a door that has opened" stay the same.

## Text
- New tooltips for Texture, Deep cuts and Scene that describe the rules above. Wave's tooltip goes away.
- On the "How Crate works" page, the side-roads section is rewritten: each road gets a short paragraph with its finish and skip rules.

## Technical details
- `lenses.ts`: drop `wave`, rewrite `info` text. Resume and saved state turn an unknown lens into `null`.
- `radio-context.tsx`: when a lens or deepCuts is on, `advance()` uses a per-road ladder instead of the Vibe/Era ladder. The new state `sideState` holds `{ texture?, era?, originArtist?, featuredUsed[] }`, plus a counter of skips in a row. It is saved with the live session and reset by `startRadio` and by toggling. The same "what if" projection is used for C and w (in `projectedCounts`/`doorProblem`). The road label on doors becomes the side-road name plus its current texture, era or artist.
- `path.functions.ts`: new `sideRoad` input `{ kind: "texture"|"deep"|"scene", step: "same"|"shift"|"featured"|"newAngle", texture?, era?, originArtist?, exclude[] }`. Each kind gets a code prefilter that picks about 15 songs from the whole library:
  - texture: genre tags mapped to texture buckets (acoustic, piano, electronic, rock, hip-hop, ambient…). For a shift, songs come from a different bucket.
  - deep: history filter (plays ≥15, ≤3 plays and no recent play in the last year), grouped by era (the year of `source_period`/first_played). For a shift, songs come from a different era group.
  - scene: a collaborator graph built from the comma-separated `artists` field, counting shared songs. Featured artists are the co-artists on the original artist's songs, ranked by count. For New Angle, the new original artist's genre tags overlap with the old one's.
  - One small AI call picks from the 15, and the DJ prompt rule for that road replaces `lensRule`. Era and Vibe road logic is skipped while a side road is on.
- Prefetching both branches and `checkPlan` work unchanged, now fed by the side-road ladder.
- Update `src/components/crate/AGENTS.md` (side-road ladders) and the project's side-road notes. Update `crate-info.tsx`.
