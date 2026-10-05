# Roadmap
- [x] Step 1: mood chat, library browser (Spotify + demo), rediscovery cards, Walrus Memory Inspector, presets/filters
- [x] Sign-in: Continue with Spotify + Try Demo Library guest mode
- [x] Walrus Memory keys saved (MEMWAL_ACCOUNT_ID / MEMWAL_PRIVATE_KEY / MEMWAL_SERVER_URL)
- [x] Spotify credentials saved and authentication connected

- [x] Refine chat density, loading motion, personalized prompts, and compact song controls
- [x] Move playback fully to Spotify live, open the Spotify app when needed, and remove Crate's bottom player
- [x] Reset the center chat on studio entry, preserve Walrus Memory, and refine the composer
- [x] Add auto-send voice prompts to the studio chat
- [x] Rename the product to Songweaver while keeping Crate as the AI companion
- [x] Add first-time Studio onboarding for Spotify sync, session start, and prompting
- [x] Add first-session Feedbacker onboarding with per-device completion
- [x] Start fresh sessions with all side roads off and restore the saved road only when resuming
- [x] Admin notepad: mindmap page for branches and future features, linked from bug reports
- [x] Skip buffer: 4-track Spotify line-up with code-picked reserves, multi-skip detection and skip-spam guard with warning toast
- [x] Fixed 4-track Spotify line-up (now, skip 1, skip 2, new angle), 1s settle before scouting, pause + warning on the 4th skip with resume once the new angle is ready
- Crate Session Synthesis: AI writes Crate-only taste insights from listening events to Walrus (auto every 7 events + on session end + manual "Let Crate reflect"); badged in Studio inspector and /admin/memory
- Memory depth: unattended-run filter (12+ untouched finishes discounted), two-tier synthesis (session observation vs cross-session anchor needing 3+ sessions), badges in inspector + /admin/memory, detailed explanation on /crate-info
- [x] Running-cost cuts: cache-friendly AI prompts, lighter reflections, library indexes/caching (keep Crate as smart)

- [x] Responsive audit: fix Studio clipping and oversized content at 1960x1080 and smaller screens
- [x] iPhone Safari support: same-tab Spotify authorization fallback, callback return, safe viewport sizing, and touch-ready session UI
- [x] Spotify observer safety: paused/stale player state cannot trigger endless skips; playback must be confirmed before Songweaver reports success
- [x] Stabilize Spotify live-status warning: ignore transient polling gaps and Crate-owned handovers
- [x] Switch compact Studio to Memory after a library-search pick and polish iPhone chat spacing
- [x] Apply the Kinetic Geometry motion system across shared controls, Studio, public pages, and reduced-motion states
- [x] Chat-based steering: replace the chip popup with mid-session chat steering ("More rap", "I'm loving it") that re-plans B/v/w ahead while C stays queued; the six-pick prompt queue stays prompt-start-only and yields to an explicit steer
- [x] Move the alternative road bars (Deep cuts, Wormhole, Scene, Texture + info) from under the chat into the Walrus Memory tab, directly above the current song
- [x] Open Spotify on iPhone/iPad opens app or web; popup returns after 10 s cooldown if no connection
