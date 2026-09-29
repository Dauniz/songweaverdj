import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { HistoryDigest } from "./listening-history";

const s = z.string().max(200);
const digestSchema = z.object({
  streams: z.number(),
  hours: z.number(),
  span: z.string().max(20),
  hourOfDay: z.array(z.number()).max(24),
  weekday: z.array(z.number()).max(7),
  shufflePct: z.number().nullable(),
  skipPct: z.number(),
  platforms: z.array(s).max(5),
  years: z.array(z.object({ year: z.number(), streams: z.number(), topArtists: z.array(s).max(8), topTracks: z.array(s).max(6) })).max(15),
  allTimeArtists: z.array(z.object({ name: s, plays: z.number(), skipPct: z.number(), lastYear: z.number() })).max(30),
  mostSkippedArtists: z.array(z.object({ name: s, plays: z.number(), skipPct: z.number() })).max(12),
  protectedTracks: z.array(s).max(15),
  fadedArtists: z.array(z.object({ name: s, peakYear: z.number(), peakPlays: z.number(), lastYear: z.number() })).max(12),
  lateNight: z.array(s).max(10),
  bingeDays: z.array(z.object({ date: s, track: s, plays: z.number() })).max(8),
});

/** Crate studies an imported streaming history and writes a long-term listener profile to Walrus. */
export const studyHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => digestSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { learnFromHistory } = await import("./history-learning.server");
    const claims = context.claims as { email?: string; user_metadata?: { full_name?: string; name?: string } };
    const who = claims?.user_metadata?.full_name ?? claims?.user_metadata?.name ?? "The listener";
    try {
      const r = await learnFromHistory(context.supabase, context.userId, data as HistoryDigest, who);
      return { saved: r.saved };
    } catch (e) {
      console.error("history study failed", e);
      return { saved: 0 };
    }
  });
