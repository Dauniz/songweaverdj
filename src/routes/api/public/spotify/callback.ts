import { createFileRoute } from "@tanstack/react-router";
import { exchangeToken, spotifyGet, verifyState } from "@/lib/spotify.server";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function page(rawMessage: string, ok: boolean) {
  const message = esc(rawMessage);
  return new Response(
    `<!doctype html><html><head><title>Spotify</title></head><body style="background:#111;color:#eee;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${ok ? "Spotify connected" : "Spotify connection failed"}</h2><p>${message}</p><p>You can close this window.</p></div><script>try{window.opener&&window.opener.postMessage({type:"spotify-connected",ok:${ok}},"*")}catch(e){};${ok ? "setTimeout(()=>window.close(),1200)" : ""}</script></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/spotify/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        if (err) return page(`Spotify said: ${err}`, false);
        if (!code || !state) return page("Missing code.", false);
        const st = verifyState(state);
        if (!st) return page("This link expired. Please try again.", false);
        try {
          const tok = await exchangeToken({
            grant_type: "authorization_code",
            code,
            redirect_uri: `${st.o}/api/public/spotify/callback`,
          });
          if (!tok.refresh_token) return page("No refresh token returned.", false);
          const me = await spotifyGet<{ display_name?: string; id: string }>(
            tok.access_token,
            "/me",
          );
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("spotify_connections").upsert({
            user_id: st.u,
            access_token: tok.access_token,
            refresh_token: tok.refresh_token,
            expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
            display_name: me.display_name ?? me.id,
            updated_at: new Date().toISOString(),
          });
          if (error) throw new Error(error.message);
          return page(`Signed in as ${me.display_name ?? me.id}.`, true);
        } catch (e) {
          console.error(e);
          return page(e instanceof Error ? e.message : "Unknown error", false);
        }
      },
    },
  },
});
