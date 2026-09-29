import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createLovableAiGatewayRunIdFetch } from "./ai/run-id.server";
import { submitMemory, type MemoryKind } from "./memwal.server";
import type { HistoryDigest } from "./listening-history";

const KINDS: MemoryKind[] = ["taste", "genre", "mood_trigger", "skipped", "session", "favorite"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function digestText(d: HistoryDigest) {
  const hours = d.hourOfDay.map((p, h) => `${h}:${p}%`).join(" ");
  const days = d.weekday.map((p, i) => `${DAYS[i]} ${p}%`).join(", ");
  return `Span ${d.span}; ${d.streams} real streams, ${d.hours} hours. Skip rate ${d.skipPct}%.${d.shufflePct !== null ? ` Shuffle on ${d.shufflePct}% of the time.` : ""} Platforms: ${d.platforms.join(", ") || "unknown"}.
Hour of day (local): ${hours}
Weekday: ${days}

Year by year:
${d.years.map((y) => `${y.year} (${y.streams} streams): artists ${y.topArtists.join(", ")} | tracks ${y.topTracks.join("; ")}`).join("\n")}

All-time artists (plays, skip %, last year played):
${d.allTimeArtists.map((a) => `${a.name} ${a.plays}x, skip ${a.skipPct}%, last ${a.lastYear}`).join("\n")}

Artists they often skip: ${d.mostSkippedArtists.map((a) => `${a.name} (${a.skipPct}% of ${a.plays})`).join(", ") || "none"}
Protected songs (many plays, almost never skipped): ${d.protectedTracks.join("; ") || "none"}
Faded artists (big once, gone now): ${d.fadedArtists.map((a) => `${a.name} peak ${a.peakYear} (${a.peakPlays}x), last ${a.lastYear}`).join("; ") || "none"}
Late-night artists (23–04 over-represented): ${d.lateNight.join(", ") || "none"}
Binge days: ${d.bingeDays.map((b) => `${b.date} ${b.track} ${b.plays}x`).join("; ") || "none"}`;
}

/** Crate studies years of streaming history and writes durable long-term memories (origin history_profile). */
export async function learnFromHistory(supabase: SupabaseClient<Database>, userId: string, digest: HistoryDigest, who: string) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { saved: 0, insights: [] as { kind: string; content: string }[] };

  const { data: old } = await supabase.from("memory_nodes").select("id").eq("origin", "history_profile");
  const { data: existing } = await supabase
    .from("memory_nodes")
    .select("content")
    .neq("origin", "history_profile")
    .order("created_at", { ascending: false })
    .limit(30);

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const { text } = await generateText({
    model: provider.responses("openai/gpt-6-luna"),
    system: `You are Crate, a music companion. ${who} just handed you their full Spotify streaming history. Study it carefully like a detective and write a LONG-TERM LISTENER PROFILE as 5–7 durable memories.

Look for: daily/weekly rituals (when they listen, and what), how their taste evolved year by year (phases, eras, turning points), artists they outgrew vs. artists that survived every era, songs they protect, what they reliably skip, patience (skip rate, shuffle habit), late-night vs daytime sound, binge behaviour, and contradictions.

Rules:
- Every memory must be backed by numbers or names from the data (years, artists, songs, hours, percentages).
- Never write the obvious ("likes pop"). Explain behaviour and meaning.
- Each memory should be something Crate can later COMPARE a live session against (e.g. "Normally 70% of listening is after 20:00", "Skips Drake in 60% of plays").
- Third person, one or two sentences, English, warm and specific.
- Do not repeat existing memories.

Return ONLY a JSON array: [{"kind":"taste","content":"..."}]. kind is one of: taste, genre, mood_trigger, skipped, session, favorite.

Existing memories:
${(existing ?? []).map((m) => `- ${m.content}`).join("\n") || "- (none)"}`,
    prompt: digestText(digest),
    providerOptions: { openai: { store: false } },
  });

  let insights: { kind: MemoryKind; content: string }[] = [];
  try {
    const raw = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as { kind?: string; content?: string }[];
    insights = raw
      .filter((r) => typeof r.content === "string" && r.content.trim().length > 25)
      .map((r) => ({ kind: (KINDS.includes(r.kind as MemoryKind) ? r.kind : "taste") as MemoryKind, content: r.content!.trim().slice(0, 400) }))
      .slice(0, 7);
  } catch {
    return { saved: 0, insights: [] };
  }
  if (!insights.length) return { saved: 0, insights: [] };

  // A new import replaces the old profile in the local mirror.
  if (old?.length) await supabase.from("memory_nodes").delete().in("id", old.map((o) => o.id));

  let saved = 0;
  for (const ins of insights) {
    const content = `From your history: ${ins.content}`;
    const { jobId, error } = await submitMemory(userId, ins.kind, content);
    const { error: dbErr } = await supabase.from("memory_nodes").insert({
      user_id: userId,
      kind: ins.kind,
      content,
      origin: "history_profile",
      blob_id: jobId ? `job:${jobId}` : null,
      status: jobId ? "pending" : error === "not_configured" ? "local" : "failed",
    });
    if (!dbErr) saved++;
  }
  return { saved, insights };
}
