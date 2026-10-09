import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildDemoRows } from "./demo-library";

const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{24,64}$/);

/** Public: start "Continue with Spotify" (sign in + connect in one step). */
export const getSpotifyLoginUrl = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ origin: z.string().url(), nonce: nonceSchema.optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { SPOTIFY_SCOPES, signState, spotifyCreds } = await import("./spotify.server");
    const creds = spotifyCreds();
    if (!creds) throw new Error("Spotify sign-in isn't set up yet. Try the demo library instead.");
    const origin = new URL(data.origin).origin;
    const params = new URLSearchParams({
      client_id: creds.clientId,
      response_type: "code",
      redirect_uri: `${origin}/api/public/spotify/callback`,
      scope: `${SPOTIFY_SCOPES} user-read-email`,
      state: signState("login", origin, data.nonce),
      show_dialog: "true",
    });
    return { url: `https://accounts.spotify.com/authorize?${params}` };
  });

/** Public: pick up a Spotify sign-in finished in another tab (single use, 10 min). */
export const claimAuthHandoff = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ nonce: nonceSchema }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("auth_handoffs" as never)
      .delete()
      .eq("nonce", data.nonce)
      .select("token_hash, created_at");
    const row = (rows as { token_hash: string; created_at: string }[] | null)?.[0];
    if (!row || Date.now() - new Date(row.created_at).getTime() > 10 * 60_000) {
      return { tokenHash: null as string | null };
    }
    return { tokenHash: row.token_hash as string | null };
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
