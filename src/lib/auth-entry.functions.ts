import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SPOTIFY_SCOPES, signState, spotifyCreds } from "./spotify.server";
import { buildDemoRows } from "./demo-library";

/** Public: start "Continue with Spotify" (sign in + connect in one step). */
export const getSpotifyLoginUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data }) => {
    const creds = spotifyCreds();
    if (!creds) throw new Error("Spotify sign-in isn't set up yet. Try the demo library instead.");
    const origin = new URL(data.origin).origin;
    const params = new URLSearchParams({
      client_id: creds.clientId,
      response_type: "code",
      redirect_uri: `${origin}/api/public/spotify/callback`,
      scope: `${SPOTIFY_SCOPES} user-read-email`,
      state: signState("login", origin),
      show_dialog: "true",
    });
    return { url: `https://accounts.spotify.com/authorize?${params}` };
  });

/** Public: create a throwaway guest account preloaded with the demo library. */
export const createGuestSession = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const id = crypto.randomUUID();
  const email = `guest-${id}@guest.crate.app`;
  const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { guest: true, display_name: "Guest" },
  });
  if (error || !data.user) throw new Error(error?.message ?? "Couldn't start guest mode");
  const { error: e2 } = await supabaseAdmin
    .from("library_tracks")
    .upsert(buildDemoRows(data.user.id), { onConflict: "user_id,spotify_id,source_name" });
  if (e2) console.error("demo seed failed", e2);
  return { email, password };
});
