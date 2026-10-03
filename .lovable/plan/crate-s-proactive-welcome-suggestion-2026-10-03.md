# Crate's proactive welcome suggestion

## What you'll see
- When you open the Studio with no session running, Crate checks the day, the time and your memories. If he is fairly sure what you'll want, a welcome card appears above the message box, for example:
  "Good evening Isac, are you feeling those acoustic vibes as you usually do on Friday nights?"
- The card has two buttons: **Yes, play it** and **Not now**.
  - **Yes** sends the suggestion as a normal prompt. Crate replies, picks the six songs and starts the session, just like a typed prompt.
  - **Not now** hides the card for the rest of this visit. Crate then waits for your input as usual. The two normal suggestions stay available.
- If Crate isn't confident enough (new account, no clear pattern for this day and time), no card appears and the Studio looks like it does today.
- The card never shows mid-session, and it doesn't come back after you say no until your next visit in a new time window (for example, later that evening or another day).

## How Crate decides
- Only memories at the "real memory" level count (anchors, history profile and promoted memories), plus listening patterns for this weekday and time of day. Single-session observations and hints alone can't trigger a welcome card.
- Crate gives a confidence score. The card shows only above a high threshold, so it stays rare and accurate.
- The greeting uses your first name from your account (or no name if there is none), and the right greeting for your local time: morning, afternoon, evening or night.
- The answer is saved as a small hint. "Yes" counts as evidence for the pattern, and "No" counts against it. This keeps future guesses sharper without creating memories on its own.

## Technical details
- New authenticated server function `getWelcomeSuggestion` in `src/lib/welcome.functions.ts`. It takes the client's local weekday, hour and timezone, then:
  - recalls Walrus memories with a query like "Friday evening listening habits", alongside top-tier `memory_nodes` (anchor / history profile / promoted kinds);
  - aggregates `listening_events` for the same weekday and a ±2 h window (last ~8 weeks), including finish/skip ratio by road and artist;
  - asks the Lovable AI model (low reasoning, structured output) for `{ confident, confidence 0–1, greeting, prompt, basis }`; returns null when confidence is below 0.75 or there are fewer than 3 supporting sessions.
- `MoodChat.tsx`: query it once per Studio entry (only while no session is live; cached per weekday+hour window in sessionStorage, plus a dismissal flag). Render a `WelcomeSuggestion` card with the kinetic `geometricEnter` motion above the composer. Yes → `send(prompt)` through the existing chat flow. No → dismiss.
- Accept/decline logged via `saveSteerInsight`-style hint (origin `welcome`) so it feeds synthesis as weak evidence only, consistent with the memory tiers.
- No change to radio, queue or maze mechanics.
- Update crate-info "Crate's skills" with a short "Welcome guess" line, and add an AGENTS.md rule for the welcome flow.
