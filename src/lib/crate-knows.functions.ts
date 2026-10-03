import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type KnowItem = { id: string; content: string; created_at: string; kind: string };
export type CrateKnows = {
  portrait: string | null;
  rhythms: { text: string; source: "sessions" | "history" }[];
  learned: KnowItem[];
  history: KnowItem[];
  hints: (KnowItem & { origin: string })[];
  sessions: number;
};

const LEARNED = ["cross_session", "synthesis", "listening"];
const clean = (s: string) => s.replace(/\s*\[s:[^\]]+\]\s*$/, "").trim();

/** Summary of what Crate knows: learned in sessions vs from history vs unconfirmed hints. */
export const getCrateKnows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrateKnows> => {
    const { supabase } = context;
    const [{ data: nodes }, { data: ev }] = await Promise.all([
      supabase.from("memory_nodes").select("id, kind, content, origin, created_at").order("created_at", { ascending: false }).limit(300),
      supabase.from("listening_events").select("session_id").not("session_id", "is", null).limit(20000),
    ]);
    const all = (nodes ?? []).map((n) => ({ ...n, content: clean(n.content) }));
    const learned = all.filter((n) => LEARNED.includes(n.origin) && n.kind !== "session");
    const history = all.filter((n) => n.origin === "history_profile");
    const hints = all.filter((n) => !LEARNED.includes(n.origin) && n.origin !== "history_profile").slice(0, 40);
    const sessions = new Set((ev ?? []).map((e) => e.session_id)).size;

    let portrait: string | null = null;
    let rhythms: CrateKnows["rhythms"] = [];
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (apiKey && (learned.length || history.length)) {
      const prompt = `Memories LEARNED IN SESSIONS (Crate figured these out by listening alongside the user):
${learned.slice(0, 60).map((m) => `- ${m.content}`).join("\n") || "- (none)"}
Memories FROM IMPORTED STREAMING HISTORY (baseline, known before Crate met them):
${history.slice(0, 30).map((m) => `- ${m.content}`).join("\n") || "- (none)"}

Using ONLY these memories (never invent), reply with JSON:
{"portrait": "2-3 warm sentences addressed to the user ('You ...'), leading with what was learned in sessions",
 "rhythms": [{"text": "short day/time/season pattern, e.g. 'Sad vibes on Wednesdays'", "source": "sessions"|"history"}]  (max 6, only real time/day/season patterns)}`;
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: "You are Crate, a warm music companion summarising what you know about your listener." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          const raw = j.choices?.[0]?.message?.content ?? "";
          const out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Partial<CrateKnows>;
          portrait = typeof out.portrait === "string" ? out.portrait.slice(0, 600) : null;
          rhythms = (Array.isArray(out.rhythms) ? out.rhythms : [])
            .filter((r) => r && typeof r.text === "string")
            .slice(0, 6)
            .map((r) => ({ text: r.text.slice(0, 120), source: r.source === "history" ? "history" : "sessions" }));
        }
      } catch (e) {
        console.error("crate-knows portrait failed", e);
      }
    }
    const strip = ({ id, content, created_at, kind }: KnowItem) => ({ id, content, created_at, kind });
    return { portrait, rhythms, learned: learned.map(strip), history: history.map(strip), hints, sessions };
  });
