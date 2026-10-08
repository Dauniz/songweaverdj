# Reframe the home page: a DJ that learns you, not a playlist

## What will change

The home page keeps its exact shape — logo, small green kicker line, big headline, one paragraph, one green pill button — and keeps Syne, Manrope, the dark palette, the lime/magenta accents, the entrance animation and the spacing. Only the words change, so the page stops selling "buried songs" and starts selling what Songweaver actually is: a DJ that learns how you listen, driving your own Spotify library.

**Headline** (one magenta accent stays, on the shortest possible phrase):

> Not a queue. A path that **learns** as you listen.

**Kicker** above it, same green small-caps treatment:

> Path radio · Walrus Memory

**Paragraph** below it, same width and grey tone — covers the maze, memory that lasts, and playback in your own Spotify app:

> Tell Crate how today feels and he builds a path through your own library — one song at a time, with two doors already lined up: one if you let it finish, one if you skip. What he learns from how you listen is stored on Walrus Memory, so every session starts sharper than the last. The music plays in your Spotify app; Crate just drives.

**Button** stays exactly as it is: "Open the studio".

One alternate for the headline, if you'd rather swap the tone — a one-line change:
- "Playlists sit still. A DJ **learns**."

## Technical details

- `src/routes/index.tsx` only: the kicker text (line 46), the `h1` content with its single `<span className="text-magenta">` (lines 48-50), and the body paragraph (lines 51-55). No class names, no layout, no motion variants touched — the staggered entrance and `bg-glow` background stay as they are.
- Route `head()` in the same file (lines 10-23): the browser tab title, `description`, `og:title` and `og:description` currently repeat "Rediscover the music you already love" / "buried favorites". They get the new framing so a shared link matches the page: title "Songweaver — a DJ that learns how you listen", description naming the path through your own Spotify library, Walrus Memory and Spotify playback. `og:type` and `twitter:card` stay.
- No new colors, tokens, fonts or components; `src/styles.css` untouched. The "What Crate knows" and "How Crate uses Walrus" pages stay as they are, since they already explain the deeper mechanics.
- Verified after the edit by re-capturing the page at desktop and phone width: nothing clipped, the headline still wraps in three lines or fewer, and the paragraph keeps its single-column width.
