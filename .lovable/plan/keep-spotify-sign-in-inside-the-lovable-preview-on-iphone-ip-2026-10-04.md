# Keep Spotify sign-in inside the Lovable preview on iPhone/iPad

## What's going wrong
- In the Lovable editor on iPhone/iPad, "Continue with Spotify" opens Spotify in a new browser tab. When Spotify finishes, that tab has lost its link back to the preview, so the sign-in finishes in the new tab and Songweaver opens there on its own.
- Because the sign-in happens in that separate tab, it is never saved in the preview. The preview keeps your sign-in through the Lovable editor, so it stays empty and you must sign in again every time.

## The fix
1. **Handoff code.** When you tap "Continue with Spotify", the preview creates a short-lived one-time code and sends it along to Spotify.
2. **Spotify tab only confirms.** When Spotify sends you back, the new tab stores the sign-in under that code and shows "Signed in — return to Lovable" (it tries to close itself). It no longer opens Songweaver itself when you started from the preview.
3. **Preview picks it up.** While waiting, the preview checks for the code every ~1.5 s, and checks right away when you switch back to it. Once the code is found, it finishes signing in inside the preview and opens the Studio. The sign-in is then saved the normal way in the preview, so it should survive closing the tab.
4. Codes expire after 10 minutes and work only once.
5. Desktop popup login and direct (non-preview) iPhone login stay as they are.
6. Connecting Spotify from inside the Studio gets the same handoff, so the preview reloads its Spotify status instead of you landing in a separate tab.

## Technical details
- New table `auth_handoffs(nonce text pk, token_hash text, created_at)` with RLS on and no client policies. Only the server uses it, through the admin client.
- `getSpotifyLoginUrl` accepts an optional `nonce`, which goes into the signed state (`signState`/`verifyState` get an optional `n` field).
- Callback: if `st.n` is present, store the `hashed_token` under that nonce. If there is no `window.opener`, render a confirmation page instead of `location.replace`.
- New public server function `claimAuthHandoff({nonce})`: it returns the token hash and deletes the row (single use, 10-minute expiry).
- `auth.tsx`: when framed on an Apple touch device, generate a nonce, poll on interval and on `visibilitychange`, then call `finishSpotify(tokenHash)`.
- Connect flow (`getSpotifyAuthUrl` + `SpotifyConnectPrompt`/`LibraryPanel`): same nonce, and the claim just signals that the connection is done, which invalidates `spotify-status`.
- Verify on mobile viewport via Playwright: framed flow stays on /auth polling; claim signs in.
- Persistence after sign-in relies on the Lovable preview's own session sharing. If iOS still drops the session after this change, the remaining cause is iOS limiting storage inside the editor. The published URL won't have that problem.
