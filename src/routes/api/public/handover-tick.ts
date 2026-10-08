import { createFileRoute } from "@tanstack/react-router";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Called once a minute by the backend while hand-over notes exist (switched off when empty).
 *  For each song ending within the minute: wait for the end, and only if it really finished
 *  send [finish song, its skip song] to Spotify — exactly what the open page would have done. */
export const Route = createFileRoute("/api/public/handover-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const token = request.headers.get("authorization")?.replace("Bearer ", "") ?? "";
        const { data: cfg } = await supabaseAdmin.from("handover_config").select("token").eq("id", 1).maybeSingle();
        if (!token || !cfg?.token || token !== cfg.token) return new Response("Unauthorized", { status: 401 });
        if (process.env["HANDOVER_HELPER"] === "off") {
          await supabaseAdmin.from("pending_handovers").delete().eq("status", "pending");
          await supabaseAdmin.rpc("disarm_handover_tick");
          return Response.json({ off: true });
        }
        const started = Date.now();
        // Tidy: notes older than 15 minutes, and pending ones whose song ended long ago.
        await supabaseAdmin.from("pending_handovers").delete().lt("created_at", new Date(started - 15 * 60_000).toISOString());
        await supabaseAdmin.from("pending_handovers").update({ status: "missed" }).eq("status", "pending").lt("ends_at", new Date(started - 30_000).toISOString());

        const { data: due } = await supabaseAdmin
          .from("pending_handovers")
          .select("user_id, track_id, ends_at, b_id, v_id")
          .eq("status", "pending")
          .lt("ends_at", new Date(started + 62_000).toISOString());
        const { spotifyAccess } = await import("@/lib/spotify.functions");

        await Promise.all((due ?? []).map(async (n) => {
          // Claim it so overlapping runs never double-send.
          const { data: claimed } = await supabaseAdmin.from("pending_handovers")
            .update({ status: "working" }).eq("user_id", n.user_id).eq("status", "pending").select("user_id");
          if (!claimed?.length) return;
          let status = "missed";
          try {
            await sleep(Math.min(new Date(n.ends_at).getTime() - 6_000, started + 52_000) - Date.now());
            const access = await spotifyAccess(n.user_id);
            if (!access) return;
            const headers = { Authorization: `Bearer ${access}` };
            const r = await fetch("https://api.spotify.com/v1/me/player", { headers });
            if (r.status !== 200) return;
            const p = (await r.json()) as { is_playing?: boolean; progress_ms?: number; item?: { id?: string; duration_ms?: number } };
            const playing = p.item?.id;
            if (playing === n.b_id) { status = "sent"; return; }
            if (playing !== n.track_id || !p.is_playing) { status = "changed"; return; }
            const remaining = (p.item?.duration_ms ?? 0) - (p.progress_ms ?? 0);
            if (remaining > (started + 57_000) - Date.now()) {
              // Ends after this run — leave it for the next minute.
              status = "pending";
              return;
            }
            // Same timing as the page: fire ~3 s before the end.
            await sleep(remaining - 3_000);
            const uris = [n.b_id, ...(n.v_id && n.v_id !== n.b_id ? [n.v_id] : [])].map((i) => `spotify:track:${i}`);
            const s = await fetch("https://api.spotify.com/v1/me/player/play", {
              method: "PUT",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ uris }),
            });
            status = s.ok ? "sent" : "missed";
            console.log("handover-tick", n.user_id.slice(0, 8), status);
          } finally {
            await supabaseAdmin.from("pending_handovers").update({ status, updated_at: new Date().toISOString() }).eq("user_id", n.user_id);
          }
        }));
        await supabaseAdmin.rpc("disarm_handover_tick");
        return Response.json({ handled: due?.length ?? 0 });
      },
    },
  },
});
