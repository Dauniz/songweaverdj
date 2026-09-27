import { createFileRoute } from "@tanstack/react-router";
import { exchangeToken, spotifyGet, verifyState } from "@/lib/spotify.server";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

function loginPage(origin: string, tokenHash: string) {
  const o = JSON.stringify(origin);
  const th = JSON.stringify(tokenHash);
  const fallback = `${origin}/auth?th=${encodeURIComponent(tokenHash)}`;
  return new Response(
    `<!doctype html><html><head><title>Spotify</title></head><body style="background:#111;color:#eee;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><p>Signing you in…</p><script>if(window.opener){window.opener.postMessage({type:"spotify-login",tokenHash:${th}},${o});setTimeout(()=>window.close(),300)}else{location.replace(${JSON.stringify(fallback)})}</script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function page(rawMessage: string, ok: boolean, returnOrigin?: string) {
  const message = esc(rawMessage);
  const fallback = returnOrigin ? `${returnOrigin}/studio` : null;
  const fallbackScript = ok && fallback
    ? `setTimeout(()=>{if(!window.opener)location.replace(${JSON.stringify(fallback)})},500)`
    : "";
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Spotify</title></head><body style="background:#111;color:#eee;font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100dvh;margin:0;padding:24px;box-sizing:border-box"><div style="text-align:center"><h2>${ok ? "Spotify connected" : "Spotify connection failed"}</h2><p>${message}</p><p>${fallback ? "Returning to Songweaver…" : "You can close this window."}</p></div><script>try{window.opener&&window.opener.postMessage({type:"spotify-connected",ok:${ok}},"*")}catch(e){};${ok ? "setTimeout(()=>window.close(),1200);" : ""}${fallbackScript}</script></body></html>`,
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
          const me = await spotifyGet<{ display_name?: string; id: string; email?: string }>(
            tok.access_token,
            "/me",
          );
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          let tokenHash: string | null = null;
          if (st.u === "login") {
            const email = me.email ?? `spotify-${me.id}@spotify.crate.app`;
            await supabaseAdmin.auth.admin.createUser({
              email,
              email_confirm: true,
              user_metadata: { display_name: me.display_name ?? me.id, spotify_id: me.id },
            }); // ignore "already registered"
            const { data: link, error: le } = await supabaseAdmin.auth.admin.generateLink({
              type: "magiclink",
              email,
            });
            if (le || !link.user) throw new Error(le?.message ?? "Couldn't sign in");
            st.u = link.user.id;
            tokenHash = link.properties.hashed_token;
          }
          const { error } = await supabaseAdmin.from("spotify_connections").upsert({
            user_id: st.u,
            access_token: tok.access_token,
            refresh_token: tok.refresh_token,
            expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
            display_name: me.display_name ?? me.id,
            updated_at: new Date().toISOString(),
          });
          if (error) throw new Error(error.message);
          if (tokenHash) return loginPage(st.o, tokenHash);
          return page(`Signed in as ${me.display_name ?? me.id}.`, true, st.o);
        } catch (e) {
          console.error(e);
          return page(e instanceof Error ? e.message : "Unknown error", false);
        }
      },
    },
  },
});
