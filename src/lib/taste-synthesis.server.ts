import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createLovableAiGatewayRunIdFetch } from "./ai/run-id.server";
import { submitMemory, type MemoryKind } from "./memwal.server";

const MODEL = "openai/gpt-6-luna";
const KINDS: MemoryKind[] = ["taste", "genre", "mood_trigger", "skipped", "session", "favorite"];

type Db = SupabaseClient<Database>;

type EventRow = {
  event: string;
  track_name: string | null;
  artists: string | null;
  mode: string | null;
  session_id: string | null;
  created_at: string;
};

function hhmm(iso: string, tzOffsetMin: number) {
  const d = new Date(new Date(iso).getTime() - tzOffsetMin * 60_000);
  const day = d.toUTCString().slice(0, 3);
  return `${day} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function period(p: string | null) {
  if (!p) return "";
  const d = new Date(`${p}T00:00:00Z`);
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * A long run of finished songs with zero interaction is more likely someone who
 * walked away (or is deep in flow) than a run of deliberate favourites. Only
 * runs of this length or longer are treated as unattended.
 */
const PASSIVE_STREAK = 12;

/** Flag indexes that sit inside a long, interaction-free run of play-throughs. */
function passiveIndexes(events: EventRow[]) {
  const passive = new Set<number>();
  let run: number[] = [];
  const flush = () => {
    if (run.length >= PASSIVE_STREAK) for (const i of run) passive.add(i);
    run = [];
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const sameSession = i > 0 && e.session_id === events[i - 1]!.session_id;
    if (e.event !== "play_through") {
      flush();
      continue;
    }
    if (!sameSession) flush();
    run.push(i);
  }
  flush();
  return passive;
}

/** Build a dense, human-readable trace of how the user actually listened. */
function traceLines(events: EventRow[], meta: Map<string, { source: string; period: string | null; album: string | null }>, tzOffsetMin: number) {
  const lines: string[] = [];
  const passive = passiveIndexes(events);
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const next = events[i + 1];
    // Dwell = time until the next event in the same session (how long they stayed).
    const dwell =
      next && next.session_id === e.session_id
        ? Math.round((new Date(next.created_at).getTime() - new Date(e.created_at).getTime()) / 1000)
        : null;
    const key = `${e.track_name}|${e.artists}`.toLowerCase();
    const m = meta.get(key);
    const verdict =
      e.event === "early_skip"
        ? `skipped${dwell !== null && dwell < 600 ? ` after ${dwell}s` : ""}`
        : e.event === "play_through"
          ? "played to the end"
          : e.event;
    lines.push(
      `${hhmm(e.created_at, tzOffsetMin)} | ${verdict} | ${e.track_name} — ${e.artists}` +
        (m?.source ? ` | from "${m.source}"${m.period ? ` (${period(m.period)})` : ""}` : "") +
        (e.mode ? ` | road ${e.mode}` : "") +
        (passive.has(i) ? " | UNATTENDED?" : ""),
    );
  }
  return lines;
}

/** One line per session: when it ran, how long, how engaged the listener was. */
function sessionLines(events: EventRow[], tzOffsetMin: number) {
  const byId = new Map<string, EventRow[]>();
  for (const e of events) {
    const id = e.session_id ?? "none";
    (byId.get(id) ?? byId.set(id, []).get(id)!).push(e);
  }
  const passive = passiveIndexes(events);
  const passiveKeys = new Set([...passive].map((i) => `${events[i]!.session_id}|${events[i]!.created_at}`));
  const out: string[] = [];
  for (const [id, rows] of byId) {
    const skips = rows.filter((r) => r.event === "early_skip").length;
    const plays = rows.filter((r) => r.event === "play_through").length;
    const unattended = rows.filter((r) => passiveKeys.has(`${r.session_id}|${r.created_at}`)).length;
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const mins = Math.round((new Date(last.created_at).getTime() - new Date(first.created_at).getTime()) / 60000);
    out.push(
      `session ${id.slice(0, 8)} | started ${hhmm(first.created_at, tzOffsetMin)} | ${mins} min | ${plays} finished, ${skips} skipped` +
        (unattended ? ` | ${unattended} finished inside an unattended run` : " | actively steered"),
    );
  }
  return out;
}


export type Insight = { kind: MemoryKind; content: string };

function parseInsights(text: string): Insight[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => r as { kind?: string; content?: string })
      .filter((r) => typeof r.content === "string" && r.content.trim().length > 25)
      .map((r) => ({
        kind: (KINDS.includes(r.kind as MemoryKind) ? r.kind : "taste") as MemoryKind,
        content: r.content!.trim().slice(0, 400),
      }))
      .slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * Crate reflects on how the user listened — not on what genres they own — and
 * writes 1–2 nuanced taste conclusions to Walrus Memory.
 */
export async function synthesizeTasteMemories(
  supabase: Db,
  userId: string,
  opts: { sessionId?: string | null; tzOffsetMin?: number; scope: "session" | "history"; displayName?: string | null },
) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { saved: 0, insights: [] as Insight[], reason: "not_configured" };
  const tz = opts.tzOffsetMin ?? 0;

  let q = supabase
    .from("listening_events")
    .select("event, track_name, artists, mode, session_id, created_at")
    .order("created_at", { ascending: false })
    .limit(opts.scope === "session" ? 60 : 600);
  if (opts.scope === "session" && opts.sessionId) q = q.eq("session_id", opts.sessionId);
  const { data: rows } = await q;
  const events = (rows ?? []).reverse() as EventRow[];
  if (events.length < 5) return { saved: 0, insights: [] as Insight[], reason: "too_little_data" };

  // Playlist provenance for the tracks involved — where in their library each song lives.
  const names = [...new Set(events.map((e) => e.track_name).filter(Boolean))] as string[];
  const { data: lib } = await supabase
    .from("library_tracks")
    .select("name, artists, album, source_name, source_period")
    .in("name", names.slice(0, 200));
  const meta = new Map<string, { source: string; period: string | null; album: string | null }>();
  for (const t of lib ?? [])
    meta.set(`${t.name}|${t.artists}`.toLowerCase(), {
      source: t.source_name,
      period: t.source_period,
      album: t.album,
    });

  const { data: existing } = await supabase
    .from("memory_nodes")
    .select("content")
    .order("created_at", { ascending: false })
    .limit(40);
  const known = (existing ?? []).map((m) => m.content);

  // Feedbacker notes: the listener's own words about songs — ground truth for spotting patterns.
  const { data: noteRows } = await supabase
    .from("memory_nodes")
    .select("content, created_at")
    .like("content", "Note on%")
    .order("created_at", { ascending: false })
    .limit(30);
  const notes = (noteRows ?? []).map((n) => `- ${hhmm(n.created_at, tz)} | ${n.content}`);

  const sessions = new Set(events.map((e) => e.session_id)).size;
  const skips = events.filter((e) => e.event === "early_skip").length;
  const plays = events.filter((e) => e.event === "play_through").length;

  const who = opts.displayName?.trim() || "The listener";
  const cross = opts.scope === "history";

  const shared = `Hard rules:
- NEVER state something obvious from their playlists ("loves R&B", "listens to hip hop"). That is banned.
- Look for: contradictions inside a genre (loves X but skips the sub-style Y), production texture (drums, bass, reverb, vocals vs instrumental), patience patterns (how many seconds before a skip, which songs they always finish), time-of-day rituals (late night vs afternoon behaviour), nostalgia vs exploration (old playlist months vs recent), artists they seem to have outgrown, and songs they protect and return to.
- Lines marked UNATTENDED? sit inside a run of ${PASSIVE_STREAK}+ finished songs with zero interaction — the listener may simply have walked away or been deep in flow. Never build a conclusion on those alone; they only count as weak support next to an active signal (a deliberate skip, a manual search, a road change, a return in another session).
- Be concrete: name real artists, songs or playlist months from the trace.
- Third person, one or two sentences each, warm and specific, English.
- Do not repeat or lightly reword an existing memory.
- Feedbacker notes are the listener's own words about specific songs. Treat them as strong evidence: connect them to the trace (e.g. a note praising warm bass + they always finish similar songs), but never just restate a note as a memory.`;

  const system = cross
    ? `You are Crate, a music companion who has followed ${who} across many separate listening sessions.

Write 1–2 DURABLE taste memories — patterns that hold up across sessions, not moods from one evening.

- Only write a memory you can support with evidence from at least 3 distinct sessions (or a clear, repeated time-of-day ritual). If nothing reaches that bar, return an empty array [].
- Say how the pattern shows across sessions ("across seven sessions", "every session started after 23:00"), and mention taste that has shifted over time when you see it.
${shared}

Return ONLY a JSON array, no prose:
[{"kind":"taste","content":"..."}]
kind is one of: taste, genre, mood_trigger, skipped, session, favorite.

Existing memories (do not repeat):
${known.length ? known.map((c) => `- ${c}`).join("\n") : "- (none)"}`
    : `You are Crate, a music companion who has been sitting next to ${who} watching exactly when their finger hits skip.

Write 1–2 memories about this single session that ONLY someone observing this listening trace could know. Keep them to what actually happened in this session; if the session was mostly unattended playback with no active choices, return an empty array [].
${shared}

Return ONLY a JSON array, no prose:
[{"kind":"taste","content":"..."}]
kind is one of: taste, genre, mood_trigger, skipped, session, favorite.

Existing memories (do not repeat):
${known.length ? known.map((c) => `- ${c}`).join("\n") : "- (none)"}`;

  const prompt = `Listening trace (${events.length} events across ${sessions} session(s); ${plays} played through, ${skips} skipped early). Local times.
${cross ? `\nSessions:\n${sessionLines(events, tz).join("\n")}\n` : ""}
${traceLines(events, meta, tz).join("\n")}
${notes.length ? `\nFeedbacker notes (their own words):\n${notes.join("\n")}` : ""}`;

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const result = streamText({
    model: provider.responses(MODEL),
    system,
    prompt,
    providerOptions: {
      openai: {
        store: false,
      },
    },
  });
  const text = await result.text;
  const insights = parseInsights(text);

  let saved = 0;
  for (const ins of insights) {
    // Skip near-duplicates of what Crate already knows.
    const head = ins.content.slice(0, 45).toLowerCase();
    if (known.some((k) => k.slice(0, 45).toLowerCase() === head)) continue;
    const { jobId, error } = await submitMemory(userId, ins.kind, ins.content);
    const { error: dbErr } = await supabase.from("memory_nodes").insert({
      user_id: userId,
      kind: ins.kind,
      content: ins.content,
      origin: cross ? "cross_session" : "synthesis",
      blob_id: jobId ? `job:${jobId}` : null,
      status: jobId ? "pending" : error === "not_configured" ? "local" : "failed",
    });
    if (!dbErr) saved++;
  }
  return { saved, insights };
}
