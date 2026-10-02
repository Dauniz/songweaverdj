# crate-info page edits

## What changes

All edits are in `src/routes/crate-info.tsx`, in the `SKILLS` array (the "Crate's skills" section). No mechanics, layout, or motion changes.

1. **Remove the Deep cuts skill entry** — the road is already described under "Alternative roads" on the same page, so the duplicate listing goes away.

2. **Reword the Feedbacker skill** so it reads as a valuable hint/input about the song playing right now, not "the sharpest signal Crate gets":

```text
The sharpest signal Crate gets: a few free words about the song playing right
now. "Nostalgi, högstadiet, sommarens första dag" ties a feeling to a track
forever, and Walrus carries it into every future session.
```

becomes:

```text
A valuable hint and input about the song playing right now: a few free words.
"Gymnasiet, sommar, Thailand" ties a feeling, event or location to a track
forever, and Walrus carries it into every future session.
```

3. **Steer skill stays unchanged** — it is the real mid-session steering chips feature (Svenskt/Engelskt/Nostalgi/Instrumental offered every ~20 minutes, six picks back to back after a prompt, chips used in 3+ sessions become permanent taste memories). Only explanation was requested, not an edit.

## Verification

- Preview the /crate-info page: Deep cuts gone from skills, new Feedbacker wording and example shown.
