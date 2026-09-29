# iPhone walkthrough of Songweaver

Go through the whole app the way an iPhone user would (iPhone 14 screen size, Safari-like browser, touch input). Write down everything that breaks, looks wrong or feels slow. No code changes during the walkthrough.

## What gets tested
1. **Landing page and sign-in:** layout, the "Continue with Spotify" and guest buttons, and the Spotify login link (does it open a real page rather than a black screen?).
2. **First Studio visit:** the onboarding tour steps, and whether the tooltips land on the right buttons on a small screen.
3. **Spotify panel:** collapse and expand, Sync, Load demo library, and the new "Import listening history" drop area (including picking a file on iPhone).
4. **Chat:** send a mood prompt and check the six suggestions, scrolling, the keyboard covering the input box, and the spacing between search and chat.
5. **Search:** find a song and start a session from it.
6. **Session and maze:** Start session, End session, Resume last session, the "If you finish" and "If you skip" boxes, the junction tree animation, side-road toggles, and the red/green Spotify status dot.
7. **Chat / Memory tabs:** switching tabs, the Walrus memory list, "Let Crate reflect", and the memory status badges.
8. **"How Crate uses Walrus" page:** readability and the back links.
9. **General:** sideways scrolling, text cut off, buttons too small to tap, console errors, slow network calls and load times.

## Limits
- The test browser can't play real Spotify audio or control a Spotify app. Spotify playback, skips and taking over a song started in Spotify can only be checked up to the point where Crate sends its song list. The demo library is used where a real Spotify library isn't needed.
- It signs in as the project's own test account, or asks you which account to use if there are several.

## What you get back
A short report with:
- what worked
- what broke, with screenshots and steps to reproduce
- what was slow, with timings
- a ranked list of suggested fixes for you to choose from

## Technical details
Playwright (Python) using the iPhone 14 device profile (390x844, touch, mobile Safari user agent), with the session restored through `lovable auth-session`. Screenshots go to /tmp/browser/iphone/. Console, network and timing data are collected for each step.
