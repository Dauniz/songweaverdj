# README verification and polish

## What I verified (all correct, no changes needed)
- Env var list matches the code exactly: `SUPABASE_*`, `MEMWAL_*`, `SPOTIFY_CLIENT_ID/SECRET`, `LOVABLE_API_KEY`, `LOVABLE_CRON_SECRET` are all real and used.
- The Spotify callback path `http://localhost:8080/api/public/spotify/callback` matches the actual route file.
- `npm install` / `npm run dev` scripts exist; migrations live in `supabase/migrations`.
- Walrus integration notes (no list API, async remember, read-after-write latency) are present and accurate.

## Gaps to fix in README.md

1. **Database setup step is missing.** The README says migrations live in `supabase/migrations` but never says how to apply them. Add a line: create a Supabase project and apply the migrations with the Supabase CLI (`supabase db push`) or paste them into the SQL editor in order, then enable email auth.

2. **Name the AI model for the Alternative AI prize.** The architecture table says "Lovable AI Gateway" but never names the model. Add that all text AI (chat, song picking, synthesis, transcription-adjacent tasks) runs on **Google Gemini 3.6 Flash** via the gateway — no OpenAI or Anthropic models — so judges see Alternative AI eligibility without reading the article.

3. **Live link + repo hygiene.** The live URL is already at the top; add a one-line note that the app needs a Spotify account (Premium for Connect playback) to try it, so judges aren't surprised.

4. **Testing note for judges.** Add a short "Trying it out" section: because the Spotify app is in Development mode, syncing a real personal library requires the account to be whitelisted by the author (Spotify's 25-user dev quota) — judges can request access. Everyone else can use the **"Try Demo Library"** button on the login page, which works without any whitelist.

4. **Small accuracy pass.** Confirm the "Using it" steps still match the current Studio flow (Start session / prompt / search, Memory Inspector now under the "Maze" tab label) and adjust wording where stale.

## Technical details
- Single file edited: `README.md`. No code changes, no data changes.
