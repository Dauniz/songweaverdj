import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Crate reflects on the listening trace and writes nuanced taste memories to Walrus. */
export const synthesizeMemories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().nullable().default(null),
        scope: z.enum(["session", "history"]).default("session"),
        tzOffsetMin: z.number().min(-900).max(900).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { synthesizeTasteMemories } = await import("./taste-synthesis.server");
    const { data: conn } = await context.supabase
      .from("spotify_connections")
      .select("display_name")
      .maybeSingle();
    try {
      const r = await synthesizeTasteMemories(context.supabase, context.userId, {
        sessionId: data.sessionId,
        scope: data.scope,
        tzOffsetMin: data.tzOffsetMin,
        displayName: conn?.display_name ?? null,
      });
      return { saved: r.saved, insights: r.insights };
    } catch (e) {
      console.error("taste synthesis failed", e);
      return { saved: 0, insights: [] as { kind: string; content: string }[] };
    }
  });
