import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const id = z.string().min(1).max(64);

/** Page is going to the background: leave a note so the backend helper can hand over the finish. */
export const saveHandoverNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ sessionId: z.string().min(1).max(128), trackId: id, endsAt: z.number().int(), bId: id, vId: id.nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (process.env["HANDOVER_HELPER"] === "off") return { ok: false };
    const ends = data.endsAt;
    // Only songs ending in the next ~15 minutes are worth a note.
    if (ends < Date.now() + 2_000 || ends > Date.now() + 15 * 60_000) return { ok: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("pending_handovers").upsert({
      user_id: context.userId,
      session_id: data.sessionId,
      track_id: data.trackId,
      ends_at: new Date(ends).toISOString(),
      b_id: data.bId,
      v_id: data.vId,
      status: "pending",
      updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false };
    await supabaseAdmin.rpc("arm_handover_tick");
    return { ok: true };
  });

/** Page is back: read what the helper did (if anything) and clear the note. */
export const takeHandoverNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("pending_handovers")
      .select("track_id, b_id, v_id, status, session_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    await context.supabase.from("pending_handovers").delete().eq("user_id", context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("disarm_handover_tick");
    return data ?? null;
  });
