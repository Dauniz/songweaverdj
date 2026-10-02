# Kinetic Geometry motion system for Songweaver

Apply the selected **Kinetic Geometry** direction across Songweaver without changing its current layout, color palette, typography, copy, Spotify behavior, Crate logic, Walrus behavior, or maze rules. Motion should feel like a precisely sequenced DJ set: immediate controls, directional state changes, and stronger choreography only when the product meaningfully changes state.

## Motion language

- Establish one shared motion scale using the existing `motion` package:
  - **Press:** 90–120 ms for tactile icon/button response.
  - **Micro state:** 140–180 ms for toggles, tabs, focus, selection, and status changes.
  - **Panel/state change:** 240–360 ms for expansion, dialogs, tab content, and lists.
  - **Narrative transition:** 500–650 ms only for the maze and major session handoffs.
- Use geometric movement: clipped reveals, short directional slides, line/path draws, compact scale changes, and staggered node/list arrivals rather than generic fades.
- Use the existing cubic-bezier curve `[0.22, 1, 0.36, 1]` for entrances and a sharper ease for exits. Avoid perpetual decorative animation except active playback, loading, or live processing indicators.
- Make every sequence interruption-safe. A rapid second click or state change should resolve to the latest state rather than queueing animations.

## Shared interaction foundation

- Add reusable motion primitives/variants for enter, exit, stagger, press, selection marker, panel expansion, and status transitions.
- Upgrade the existing button component so normal buttons, icon controls, pills, and destructive actions share tactile press feedback without changing their appearance or hit areas.
- Harmonize dialogs, alerts, tooltips, popovers, progress indicators, and toasts with the timing scale: anchored origin, crisp overlay transition, and clear success/error state change.
- Preserve keyboard focus and screen-reader behavior; motion must not delay an action or block input.

## Site-wide choreography

### Entry and navigation
- Give the home and sign-in screens a short staged entrance: logo, headline/card, supporting text, then primary action. Keep the first action available immediately.
- Crossfade route content with a very small directional offset; never animate the entire viewport like a slideshow.
- Turn the compact Chat/Memory control into a shared moving selection marker while preserving its current centered layout and responsive behavior.

### Studio controls
- Animate the Spotify panel from its fixed anchor when minimized or expanded instead of replacing it abruptly; counts, connection status, sync progress, and completion state update in place.
- Add immediate down/up feedback to session, playback, skip, road, search-result, and Feedbacker controls. Active road pills use a geometric fill/outline transition rather than a simple color swap.
- Animate the recent-sync dialog, onboarding spotlight, and Feedbacker editor from their triggering control or target, with clean reverse exits.
- Keep loaders purposeful: rotating geometry for network work, a travelling progress edge for sync, and stepped dots/lines for Crate’s active reasoning.

### Chat and recommendations
- Stage prompt submission as one continuous handoff: submitted prompt settles into the transcript, Crate’s thinking indicator takes its place, streamed text reveals without reflow jumps, then the six recommendations enter in a short ordered cascade.
- New track cards should arrive with a clipped vertical reveal and 25–40 ms stagger; card actions remain usable as soon as each card appears.
- Search results open and close from the input edge, preserve scroll position, and use geometric selection feedback when a song starts the maze.
- Auto-scroll and “jump to latest” movement should be smooth but cancel immediately when the listener scrolls manually.

### Walrus Memory and panels
- Animate memory-count changes and newly written memory rows without replaying the whole list. Pending → stored should visibly resolve in place.
- Expand/collapse the Walrus log and Crate console from their anchored bars using measured height and opacity; retain the existing draggable console behavior.
- Give “Let Crate reflect,” copied blob IDs, warnings, and reset confirmation concise state transitions with no decorative delay.
- On the information page, use restrained section reveals only on first entry; cards do not repeatedly animate while scrolling back and forth.

### The maze
- Keep the existing JunctionTree promotion/reset sequence as the strongest motion moment.
- Refine its visual language toward Kinetic Geometry: exact path drawing, crisp node emphasis, a directional chosen-path pulse, and synchronized labels/cards.
- Align its timings and reduced-motion behavior with the shared system, while keeping animation state completely separate from playback and queue state.

## Reduced motion and performance

- Under `prefers-reduced-motion`, replace translation, scaling, path travel, stagger, and parallax with a single 100–120 ms opacity/state change; keep only essential progress/spinner feedback.
- Animate transform, opacity, clip-path, and measured height where appropriate; avoid layout-heavy movement on frequently updating playback views.
- Prevent entrance animation from replaying on every query refresh, Spotify poll, or streamed token.
- Verify that no animation introduces overlap, clipping, horizontal scrolling, focus loss, delayed clicks, or a shifted bottom control bar on phone, tablet, or desktop.

## Date-issue preflight

- The current Spotify playlist parser emits `YYYY-MM-01`, and the current `library_tracks.source_period` rows contain no malformed dates. No date fix will be mixed into this visual work unless the out-of-range value can be reproduced from a specific playlist input.
- Add a focused parser regression case for names with numeric month/year ordering so the previously reported `2014-20-01` shape cannot return unnoticed.

## Technical scope

- Centralize shared motion constants and variants in a small client-safe motion module; keep component-specific sequencing beside the component it controls.
- Update the existing shared controls and the current route/components that own each interaction. Do not add a second animation library or rewrite product structure.
- Record the shared motion-system boundary in `AGENTS.md` because it becomes an app-wide implementation rule.

## Verification

- Check the public home, sign-in, Studio empty state, Studio active-session state, Chat/Memory switching, Spotify panel, prompt/results flow, search, side roads, Walrus log, console, dialogs, onboarding, and Crate information page.
- Test desktop, tablet, and phone sizes, plus keyboard-only use and reduced-motion mode.
- Confirm fast repeated interactions settle correctly and no motion fires from background polling alone.
- Run focused tests for the date parser and the relevant interaction state, then confirm the preview build is healthy.
- Real Spotify playback handoffs remain a live-account check; motion must never alter or delay those commands.
