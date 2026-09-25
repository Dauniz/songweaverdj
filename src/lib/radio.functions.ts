import { createServerFn } from "@tanstack/react-start";
import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recallMemories, submitMemory } from "./memwal.server";

const MODEL = "openai/gpt-6-astra";

const eventSchema = z.object({
  trackId: z.string().nullable(),
  trackName: z.string(),
  artists: z.string(),
  event: z.enum(["play_through", "early_skip", "replay", "explicit_fav", "explicit_skip"]),
  sessionId: z.string(),
  mode: z.enum(["era", "vibe"]).nullable(),
});

type EventInput = z.infer<typeof eventSchema>;

async function saveSignalMemory(
  supabase: any,
  userId: string,
  kind: "taste" | "skipped" | "favorite" | "session",
  content: string,
) {
  // Avoid near-duplicate memories for the same track/artist
  const key = content.slice(0, 40);
  const { data: existing } = await supabase
    .from("memory_nodes")
    .select("id")
    .ilike("content", `${key}%`)
    .limit(1);
  if (existing?.length) return;
  const { jobId, error } = await submitMemory(userId, kind, content);
  await supabase.from("memory_nodes").insert({
    user_id: userId,
    kind,
    content,
    origin: "listening",
    blob_id: jobId ? `job:${jobId}` : null,
    status: jobId ? "pending" : error === "not_configured" ? "local" : "failed",
  });
}

export const logListeningEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => eventSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("listening_events").insert({
      user_id: userId,
      track_id: data.trackId,
      track_name: data.trackName,
      artists: data.artists,
      event: data.event,
      session_id: data.sessionId,
      mode: data.mode,
    });
    if (error) throw new Error(error.message);

    const learned: string[] = [];

    if (data.event === "replay" || data.event === "explicit_fav") {
      await saveSignalMemory(
        supabase,
        userId,
        "favorite",
        `Loves "${data.trackName}" by ${data.artists} — replayed it when it resurfaced.`,
      );
      learned.push("favorite");
    }
    if (data.event === "explicit_skip") {
      await saveSignalMemory(
        supabase,
        userId,
        "skipped",
        `Skipped "${data.trackName}" by ${data.artists} — don't resurface it for now.`,
      );
      learned.push("skipped");
    }
    if (data.event === "early_skip") {
      // 2 early skips of the same track -> skip memory
      const { count: trackSkips } = await supabase
        .from("listening_events")
        .select("id", { count: "exact", head: true })
        .eq("event", "early_skip")
        .eq("track_name", data.trackName)
        .eq("artists", data.artists);
      if ((trackSkips ?? 0) >= 2) {
        await saveSignalMemory(
          supabase,
          userId,
          "skipped",
          `Skipped "${data.trackName}" by ${data.artists} early more than once — don't resurface it.`,
        );
        learned.push("skipped");
      }
      // 3 early skips of the same artist this session -> avoid artist for now
      const { count: artistSkips } = await supabase
        .from("listening_events")
        .select("id", { count: "exact", head: true })
        .eq("event", "early_skip")
        .eq("session_id", data.sessionId)
        .eq("artists", data.artists);
      if ((artistSkips ?? 0) >= 3) {
        await saveSignalMemory(
          supabase,
          userId,
          "taste",
          `Isn't feeling ${data.artists} right now — skipped several of their tracks in one session.`,
        );
        learned.push("artist-avoid");
      }
    }
    if (data.event === "play_through" && data.mode) {
      // 3 full plays in the same mode -> taste memory about what works
      const { count: plays } = await supabase
        .from("listening_events")
        .select("id", { count: "exact", head: true })
        .eq("event", "play_through")
        .eq("session_id", data.sessionId)
        .eq("mode", data.mode);
      if ((plays ?? 0) === 3) {
        await saveSignalMemory(
          supabase,
          userId,
          "session",
          data.mode === "era"
            ? `Era-based radio worked well — listened through several tracks from the same period.`
            : `Vibe-based radio worked well — listened through several mood-matched tracks.`,
        );
        learned.push("session");
      }
    }
    return { ok: true, learned };
  });

function fmtPeriod(p: string | null) {
  if (!p) return "";
  const d = new Date(p + "T00:00:00Z");
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export const refillRadioQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        seedPrompt: z.string().min(1).max(1000),
        mode: z.enum(["era", "vibe"]).nullable(),
        steering: z.string().max(300).optional(),
        excludeIds: z.array(z.string()).max(500).default([]),
        recentFeedback: z
          .array(z.object({ event: z.string(), track: z.string() }))
          .max(20)
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured.");

    // Library (paged, capped)
    const tracks: {
      id: string;
      name: string;
      artists: string;
      album: string | null;
      source_name: string;
      source_period: string | null;
      source_type: string;
    }[] = [];
    for (let from = 0; from < 6000; from += 1000) {
      const { data: page } = await supabase
        .from("library_tracks")
        .select("id, name, artists, album, source_name, source_period, source_type")
        .order("source_period", { ascending: true, nullsFirst: true })
        .order("id")
        .range(from, from + 999);
      if (!page?.length) break;
      tracks.push(...page);
      if (page.length < 1000) break;
    }
    const excluded = new Set(data.excludeIds);
    const available = tracks.filter((t) => !excluded.has(t.id));
    const index = new Map<string, (typeof tracks)[number]>();
    const libLines = available.map((t, i) => {
      const code = `T${i}`;
      index.set(code, t);
      return `${code} | ${t.name} — ${t.artists} | ${t.source_name}${t.source_period ? ` (${fmtPeriod(t.source_period)})` : ""}`;
    });

    const recalled = await recallMemories(userId, data.seedPrompt, 8);
    const memoryLines = recalled.map((m) => `- ${m.text}`).join("\n");

    const feedbackLines = data.recentFeedback.length
      ? data.recentFeedback.map((f) => `- ${f.event}: ${f.track}`).join("\n")
      : "- (none yet)";

    const system = `You are Crate's radio DJ. The user started a radio session with this prompt: "${data.seedPrompt}".
${data.steering ? `They just steered the session: "${data.steering}". Adjust the picks accordingly.\n` : ""}
${
  data.mode
    ? `Session mode is locked to "${data.mode}": ${
        data.mode === "era"
          ? "keep pulling tracks from the same time period / playlists as the seed."
          : "keep pulling tracks that match the mood or setting, regardless of era."
      }`
    : `Decide the session mode: "era" if the prompt is about nostalgia, a year, a specific song, or a past period; "vibe" if it is about a setting, activity, or feeling (dinner, sad, focus, gym…).`
}

Rules:
- Only pick tracks from the library list below, by their codes. Never invent tracks.
- Pick 8 tracks that continue the session naturally.
- Never pick a track that memory says was skipped.
- Recent listening feedback this session:
${feedbackLines}

Walrus Memory about this user:
${memoryLines || "- (none yet)"}

Library (${available.length} tracks; code | title — artist | source):
${libLines.join("\n") || "(empty)"}`;

    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    const result = streamText({
      model: provider.responses(MODEL),
      system,
      messages: [{ role: "user", content: "Queue the next 8 tracks." }],
      stopWhen: stepCountIs(2),
      providerOptions: {
        openai: {
          store: false,
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
      tools: {
        queue_tracks: tool({
          description: "Queue the next radio tracks from the user's library.",
          inputSchema: z.object({
            mode: z.enum(["era", "vibe"]),
            mode_label: z
              .string()
              .describe("Short label for the chip, e.g. 'Era: 2019' or 'Vibe: late-night dinner'"),
            picks: z.array(z.object({ code: z.string() })).min(1).max(10),
          }),
          execute: async ({ mode, mode_label, picks }) => ({ mode, mode_label, picks }),
        }),
      },
    });

    // Consume the stream server-side and extract the tool call
    const steps = await result.steps;
    type Queued = { mode: "era" | "vibe"; mode_label: string; picks: { code: string }[] };
    let queued: Queued | null = null;
    for (const step of steps) {
      for (const tc of step.toolCalls) {
        if (tc.toolName === "queue_tracks") queued = tc.input as Queued;
      }
    }
    if (!queued) throw new Error("The DJ couldn't queue more tracks right now.");

    const picked = queued.picks
      .map((p) => index.get(p.code.trim()))
      .filter(Boolean) as (typeof tracks)[number][];
    const ids = picked.map((t) => t.id);
    const { data: full } = await supabase
      .from("library_tracks")
      .select("id, spotify_id, image_url, preview_url, spotify_url")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((full ?? []).map((f) => [f.id, f]));

    return {
      mode: queued.mode,
      modeLabel: queued.mode_label,
      tracks: picked.map((t) => ({
        ...t,
        ...(byId.get(t.id) ?? {}),
        period_label: fmtPeriod(t.source_period),
      })),
    };
  });
