# Songweaver interaction and motion overhaul

Make navigation and every interactive state feel deliberate, responsive and musical without changing Songweaver's layout, copy, Spotify behavior, Crate logic, Walrus behavior, queue rules or maze rules. Preserve Songweaver's visual identity exactly: the black/dark foundation, vivid green and pink accents, strong yellow reserved for Crate actions, and the existing bold Syne display type with Manrope body type. Motion should amplify that identity, never restyle it. The direction builds on the existing Kinetic Geometry system rather than adding a second visual language.

## Inspiration translated into Songweaver

Apply the useful parts of the School of Motion references:

- **Eszter Bial:** restrained movement, polished easing and continuity between related states.
- **Uncommon Studio:** short, rhythmic staggers that guide the eye without delaying work.
- **Unseen Studio:** simple but unmistakable hover states and navigation that feels alive.
- **Dropbox:** animation that explains what changed, especially loading, saved, connected and active states.
- **Apple:** limited color, strong focal hierarchy and consistently smooth performance on older phones/tablets.
- **Epic / Active Theory:** purposeful anticipation only for meaningful events such as entering a session or choosing a maze door.
- **Rive:** approachable stateful microinteractions, implemented with the motion tools already in the project rather than adding Rive.

Do not copy the unsuitable parts: no custom cursor, inertial-scroll takeover, pointer-reactive WebGL/3D, cinematic scroll scrubbing, hover-only navigation or recurring full-screen spectacle.

## 1. One interaction language

- Expand the shared motion foundation into named patterns for hover, press, focus, state swap, shared-element travel, list stagger, anchored panel, success/error/status and reduced motion.
- Give every interactive control an obvious desktop hover response: a coordinated surface/border/text change plus a small icon or content movement. Avoid making everything simply grow.
- Give touch devices an equivalent immediate press response and persistent selected state; no essential feedback depends on hover.
- Standardize mouse pointers, focus rings, disabled/busy states and tooltips across buttons, icon controls, links, rows, cards and draggable handles.
- Keep actions immediate. Animation observes and explains state changes; it never delays Spotify commands, navigation or data updates.

## 2. Navigation and page flow

- Add restrained route entrances/exits for Home, sign-in, Studio, “What Crate knows” and “How Crate uses Walrus”: small directional movement, clipped reveal and a stable header/logo anchor rather than a slideshow transition.
- Make Studio Chat/Maze switching feel spatial: the active marker travels between tabs, incoming content follows the selected direction, and scroll/focus remain stable.
- Refine Studio's desktop column resizing so Chat and Maze rebalance as one continuous movement when a session starts or ends, without text reflow jumps.
- Animate back links, header icons and public calls to action with directional icon movement and clear focus/hover feedback.

## 3. The maze as the strongest motion moment

- Preserve the existing JunctionTree promotion/reset logic, but make the door-to-current-song handoff a true shared visual transition: artwork, title and card geometry travel as one object while the old current song and unchosen path exit coherently.
- Synchronize the chosen-path pulse, travelling song, label change, new branch draw and new-door arrival into one interruption-safe sequence.
- Smooth changes between two doors, one centered queued door and a multi-song queued chain. Existing cards should reposition rather than disappear and reappear.
- Animate “Finding…” resolving into a real door in place, and make branch/status changes readable without replaying the whole tree.
- Keep animation state isolated from playback and queue state. Rapid skips, finishes, searches and road changes resolve to the latest confirmed state.

## 4. Studio controls and feedback

- Upgrade search results, suggestion cards, recommendation cards and memory rows with clear row/card hover treatment, artwork response, action reveal and immediate selected/saved/skipped feedback.
- Make prompt submission one continuous handoff: the prompt settles into the transcript, Crate's working state appears in its place, streamed content stays stable, then recommendations arrive in a short rhythm.
- Animate Spotify pill ↔ expanded panel from the same anchor; preserve the pill's iPad reliability. Connection dot, sync progress and completion update in place with restrained status motion.
- Give session start/end, play/pause, next, alternative roads, Feedbacker, Crate reflection, copy actions and onboarding controls meaningful icon/state transitions.
- Expand/collapse Walrus log and Crate console from their trigger bars with measured movement; new memories and pending → stored updates resolve in place without replaying the entire list.
- Keep dialogs, popovers, tooltips and toasts anchored to their origin with crisp reverse exits and no decorative waiting.

## 5. Graphics and atmosphere

- Use Songweaver's existing artwork, maze paths, EQ bars and geometric lines as the visual material. Add subtle path traces, edge highlights and state indicators only where they communicate live playback, direction, progress or success.
- Keep the existing black, green and pink color profile unchanged. Let album artwork add variation, while green continues to signal playback/maze direction, pink provides the contrasting Songweaver accent, and Crate actions remain plain strong yellow with no green fill or glow.
- Preserve the current weighty typographic character: Syne for bulky titles and display moments, Manrope for substantial, readable interface and body text. Motion may reveal or shift type, but must not replace, thin out or soften the fonts.
- Avoid decorative 3D, particles and perpetual motion. Only playback, active processing and live progress may loop.

## Reduced motion and performance

- Under `prefers-reduced-motion`, replace travel, scale, stagger and path motion with a 100–120 ms state fade while retaining essential progress indication.
- Favor transform, opacity and clip-path; reserve measured height for panels. Prevent background polling, streaming tokens and query refreshes from replaying entrances.
- Keep hover effects behind hover-capable media queries so touch interactions do not stick in a hover state.
- Maintain stable dimensions so animation never shifts controls, overlaps content, clips the Spotify pill or creates horizontal scrolling.

## Technical scope

- Extend `src/lib/motion.ts` and the existing global kinetic utilities; use the installed `motion` package only.
- Apply shared behavior through the existing Button and UI primitives first, then focused component choreography in Studio, PathMaze, chat/search/cards, Spotify panel, Memory inspector, onboarding and content routes.
- Use shared layout identity only inside safe visual boundaries; do not let it couple Chat, Maze or playback state.
- Preserve the architecture rule in `AGENTS.md`: motion remains client-safe, accessible and independent from product actions.
- Opus 5.5 is not selectable from this project workspace; implementation will use the strongest available coding agent while keeping the reviewed plan as the source of truth.

## Verification

- Exercise Home → sign-in → Studio, Chat/Maze switching, start/end session, search, prompt/results, suggestions, Spotify panel, side roads, door promotion, queued chain, Walrus log, console, dialogs, onboarding and both information pages.
- Check desktop with mouse, keyboard-only use, iPhone and tablet touch layouts, short screens and `prefers-reduced-motion`.
- Stress rapid repeated clicks and consecutive maze changes; verify the latest state wins and controls remain usable throughout.
- Inspect animation smoothness, layout shift, clipping and horizontal overflow. Confirm the preview remains error-free and run relevant existing interaction tests.
- Real Spotify door handoffs remain a live-device check because playback cannot be exercised in the sandbox; motion must not alter their timing or commands.
