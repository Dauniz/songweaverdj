import { createOpenAI } from "@ai-sdk/openai";
import { createClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "./ai/run-id.server";
import { recallMemories, submitMemory } from "./memwal.server";

const MODEL = "openai/gpt-6-astra";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function authed(request: Request) {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || token.split(".").length !== 3) return null;
  const supabase = createClient<Database>(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return { supabase, userId: data.claims.sub as string };
}

function fmtPeriod(p: string | null) {
  if (!p) return "";
  const d = new Date(p + "T00:00:00Z");
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export async function handleChat(request: Request) {
  const auth = await authed(request);
  if (!auth) return json(401, { error: "Please sign in again." });
  const { supabase, userId } = auth;
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return json(500, { error: "AI is not configured." });

  let body: { messages: UIMessage[] };
  try {
    body = await request.json();
    if (!Array.isArray(body.messages) || body.messages.length === 0) throw new Error();
  } catch {
    return json(400, { error: "Invalid request" });
  }
  const messages = body.messages.slice(-30);
  const last = messages[messages.length - 1]!;
  const lastText = last.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .slice(0, 1000);

  if (last.role === "user") {
    const { error } = await supabase
      .from("chat_messages")
      .insert({ user_id: userId, message: last as never });
    if (error) console.error("save user message failed", error);
  }

  // Library context
  const { data: lib } = await supabase
    .from("library_tracks")
    .select("id, name, artists, album, source_name, source_period, source_type")
    .order("source_period", { ascending: true, nullsFirst: true })
    .limit(700);
  const tracks = lib ?? [];
  const index = new Map<string, (typeof tracks)[number]>();
  const libLines = tracks.map((t, i) => {
    const code = `T${i}`;
    index.set(code, t);
    return `${code} | ${t.name} — ${t.artists} | ${t.source_name}${t.source_period ? ` (${fmtPeriod(t.source_period)})` : ""}`;
  });

  // Walrus memory recall + local mirror (for skip lists etc.)
  const [recalled, { data: localMem }] = await Promise.all([
    recallMemories(userId, lastText || "music taste and mood preferences", 8),
    supabase
      .from("memory_nodes")
      .select("kind, content")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);
  const memoryLines = [
    ...recalled.map((m) => `- (walrus) ${m.text}`),
    ...(localMem ?? []).map((m) => `- [${m.kind}] ${m.content}`),
  ];

  const system = `You are Crate, a warm, music-obsessed rediscovery companion. The user has hundreds of artists spread across monthly playlists; great songs get buried. Your job: take today's vibe and resurface tracks they ALREADY love from their library below. Never recommend songs that are not in the library.

How to respond:
1. One or two short sentences reflecting the vibe back (no lists).
2. Call recommend_tracks with 5–8 tracks. Favor forgotten gems from older playlists over recent plays; mix eras. Each reason is one vivid sentence tying the song to the vibe and, when useful, to a memory.
3. When the user reveals a durable preference (a genre they love, a mood trigger, a track/artist to skip, a session ritual), call save_memory once per distinct fact. Always save one "session" memory summarising today's vibe.
4. If a track appears in memory as skipped, do not recommend it.
5. If the library is empty, tell them to connect Spotify or load the demo library in the Library tab.

Walrus Memory about this user:
${memoryLines.length ? memoryLines.join("\n") : "- (none yet)"}

Library (${tracks.length} tracks; code | title — artist | source):
${libLines.join("\n") || "(empty)"}`;

  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const result = streamText({
    model: provider.responses(MODEL),
    system,
    messages: await convertToModelMessages(messages),
    abortSignal: request.signal,
    stopWhen: stepCountIs(4),
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
      recommend_tracks: tool({
        description: "Show rediscovery cards for tracks from the user's library.",
        inputSchema: z.object({
          vibe_title: z.string().describe("Short evocative title for this session, e.g. 'Neon rain focus'"),
          picks: z
            .array(
              z.object({
                code: z.string().describe("Track code like T12 from the library list"),
                reason: z.string(),
              }),
            )
            .min(1)
            .max(10),
        }),
        execute: async ({ vibe_title, picks }) => {
          const cards = picks
            .map((p) => {
              const t = index.get(p.code.trim());
              return t ? { ...t, reason: p.reason, period_label: fmtPeriod(t.source_period) } : null;
            })
            .filter(Boolean) as Array<Record<string, unknown>>;
          const ids = cards.map((c) => c.id as string);
          const { data: full } = await supabase
            .from("library_tracks")
            .select("id, spotify_id, image_url, preview_url, spotify_url")
            .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
          const byId = new Map((full ?? []).map((f) => [f.id, f]));
          return {
            vibe_title,
            tracks: cards.map((c) => ({ ...c, ...(byId.get(c.id as string) ?? {}) })),
          };
        },
      }),
      save_memory: tool({
        description: "Persist a durable fact about the user's music taste to Walrus Memory.",
        inputSchema: z.object({
          kind: z.enum(["taste", "genre", "mood_trigger", "skipped", "session", "favorite"]),
          content: z.string().describe("One concise sentence"),
        }),
        execute: async ({ kind, content }) => {
          const { jobId, error } = await submitMemory(userId, kind, content);
          const status = jobId ? "pending" : error === "not_configured" ? "local" : "failed";
          const { error: dbErr } = await supabase.from("memory_nodes").insert({
            user_id: userId,
            kind,
            content,
            blob_id: jobId ? `job:${jobId}` : null,
            status,
          });
          if (dbErr) console.error("memory mirror failed", dbErr);
          return { kind, content, status };
        },
      }),
    },
  });

  const response = result.toUIMessageStreamResponse({
    originalMessages: messages,
    sendReasoning: true,
    onFinish: async ({ responseMessage }) => {
      const { error } = await supabase
        .from("chat_messages")
        .insert({ user_id: userId, message: responseMessage as never });
      if (error) console.error("save assistant message failed", error);
    },
    onError: (e) => {
      console.error("chat stream error", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("402")) return "AI credits are used up. Add credits in Settings → Plans & credits.";
      if (msg.includes("429")) return "Too many requests right now — try again in a moment.";
      return "Something went wrong generating a reply.";
    },
  });
  return withLovableAiGatewayRunIdHeader(response, runIdFetch);
}
