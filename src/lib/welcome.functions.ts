import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const partOf = (h: number) => (h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night");

export type WelcomeSuggestion = { greeting: string; prompt: string; confidence: number } | null;

/** Proactive welcome guess: only strong memories + same weekday/time listening can trigger it. */
export const getWelcomeSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ tzOffsetMin: z.number().int().min(-900).max(900), firstName: z.string().max(40).default("") }).parse(d),
  )
  .handler(async ({ data, context }): Promise<WelcomeSuggestion> => {
    const { supabase, userId } = context;
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return null;
    const localNow = new Date(Date.now() - data.tzOffsetMin * 60_000);
    const day = localNow.getUTCDay();
    const hour = localNow.getUTCHours();
    const part = partOf(hour);

    const since = new Date(Date.now() - 56 * 864e5).toISOString();
    const [{ data: events }, { data: strong }, { data: welcomeHints }] = await Promise.all([
      supabase.from("listening_events").select("created_at, event, artists, track_name, mode, session_id").gte("created_at", since).limit(5000),
      supabase.from("memory_nodes").select("kind, content, origin").in("origin", ["cross_session", "history_profile"]).order("created_at", { ascending: false }).limit(30),
      supabase.from("memory_nodes").select("content").eq("origin", "welcome").order("created_at", { ascending: false }).limit(10),
    ]);

    // Same weekday, ±2h window.
    const sessions = new Set<string>();
    const artistCount = new Map<string, { fin: number; skip: number }>();
    const lines: string[] = [];
    for (const e of events ?? []) {
      const t = new Date(new Date(e.created_at).getTime() - data.tzOffsetMin * 60_000);
      const dh = Math.abs(t.getUTCHours() - hour);
      if (t.getUTCDay() !== day || Math.min(dh, 24 - dh) > 2) continue;
      sessions.add(e.session_id ?? t.toISOString().slice(0, 10));
      const skip = /skip/i.test(e.event);
      const a = (e.artists ?? "").split(",")[0]!.trim();
      if (a) {
        const c = artistCount.get(a) ?? { fin: 0, skip: 0 };
        if (skip) c.skip++; else c.fin++;
        artistCount.set(a, c);
      }
      if (lines.length < 80) lines.push(`${e.event}: ${e.track_name} — ${e.artists}${e.mode ? ` (${e.mode})` : ""}`);
    }
    if (sessions.size < 3 || !(strong ?? []).length) return null;
    const topArtists = [...artistCount.entries()].sort((a, b) => b[1].fin - a[1].fin).slice(0, 12)
      .map(([a, c]) => `${a}: ${c.fin} finished, ${c.skip} skipped`);

    let recalled: { text: string }[] = [];
    try {
      const { recallMemories } = await import("./memwal.server");
      recalled = await recallMemories(userId, `${DAYS[day]} ${part} listening habits`, 6);
    } catch { /* optional */ }

    const prompt = `Now: ${DAYS[day]} ${part} (${hour}:00 local). Listener first name: ${data.firstName || "(unknown)"}.
Sessions in this weekday/time window over 8 weeks: ${sessions.size}.
Top artists in this window:\n${topArtists.join("\n") || "(none)"}
Sample events:\n${lines.join("\n")}
Strong memories (anchors / long-term profile):\n${(strong ?? []).map((m) => `- [${m.origin}] ${m.content}`).join("\n")}
Walrus recall:\n${recalled.map((r) => `- ${r.text}`).join("\n") || "- (none)"}
Earlier welcome answers (weak hints; declines lower confidence for similar guesses):\n${(welcomeHints ?? []).map((w) => `- ${w.content}`).join("\n") || "- (none)"}

Decide if you can confidently guess what they want to hear right now, based on a REPEATED pattern for this weekday/time backed by both memories and listening. Reply ONLY with JSON:
{"confidence": 0-1, "greeting": "one warm question, e.g. 'Good evening Isac, are you feeling those acoustic vibes as you usually do on Friday nights?' (use the name if known, greeting fitting ${part})", "prompt": "the chat prompt to start the session with, written as the listener, e.g. 'Acoustic Friday night vibes like usual'"}`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          messages: [
            { role: "system", content: "You are Crate, a careful music DJ. Only claim high confidence for clear recurring habits." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = j.choices?.[0]?.message?.content ?? "";
      const out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { confidence?: number; greeting?: string; prompt?: string };
      if (!out.greeting || !out.prompt || (out.confidence ?? 0) < 0.75) return null;
      return { greeting: out.greeting.slice(0, 220), prompt: out.prompt.slice(0, 300), confidence: out.confidence! };
    } catch (e) {
      console.error("welcome suggestion failed", e);
      return null;
    }
  });

/** Log the accept/decline as a weak hint (origin "welcome"); never a memory on its own. */
export const answerWelcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ prompt: z.string().min(1).max(300), accepted: z.boolean(), tzOffsetMin: z.number().int().min(-900).max(900) }).parse(d))
  .handler(async ({ data, context }) => {
    const local = new Date(Date.now() - data.tzOffsetMin * 60_000);
    const content = `Welcome guess ${data.accepted ? "accepted" : "declined"} (${DAYS[local.getUTCDay()]} ${partOf(local.getUTCHours())}): ${data.prompt}`;
    const { error } = await context.supabase.from("memory_nodes").insert({
      user_id: context.userId, kind: "mood_trigger", content, origin: "welcome", status: "local",
    });
    if (error) console.error("welcome hint failed", error);
    return { ok: true };
  });
