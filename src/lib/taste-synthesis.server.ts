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


/** Pre-digested behavioural signals so the model reasons over patterns, not raw rows. */
function signalLines(events: EventRow[], tzOffsetMin: number, history: Map<string, { plays: number; lastYear: string | null }>) {
  const out: string[] = [];
  // Skip timing: instant (<15 s) = clash, early (<60 s) = wrong direction, late = fatigue/length.
  const buckets = { instant: 0, early: 0, late: 0 };
  const artist = new Map<string, { fin: number; skip: number; instant: number }>();
  const road = new Map<string, { fin: number; skip: number }>();
  const hour = new Map<string, { fin: number; skip: number }>();
  let bestRun = 0, run = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const next = events[i + 1];
    const dwell = next && next.session_id === e.session_id ? (Date.parse(next.created_at) - Date.parse(e.created_at)) / 1000 : null;
    const fin = e.event === "play_through";
    const skip = e.event === "early_skip";
    if (!fin && !skip) continue;
    run = fin ? run + 1 : 0;
    bestRun = Math.max(bestRun, run);
    if (skip && dwell !== null) buckets[dwell < 15 ? "instant" : dwell < 60 ? "early" : "late"]++;
    const a = (e.artists ?? "?").split(",")[0]!.trim();
    const as = artist.get(a) ?? { fin: 0, skip: 0, instant: 0 };
    if (fin) as.fin++; else { as.skip++; if (dwell !== null && dwell < 15) as.instant++; }
    artist.set(a, as);
    const r = road.get(e.mode ?? "none") ?? { fin: 0, skip: 0 };
    fin ? r.fin++ : r.skip++;
    road.set(e.mode ?? "none", r);
    const h = new Date(Date.parse(e.created_at) - tzOffsetMin * 60_000).getUTCHours();
    const slot = h < 5 ? "night 00-05" : h < 11 ? "morning 05-11" : h < 17 ? "afternoon 11-17" : h < 22 ? "evening 17-22" : "late 22-24";
    const hs = hour.get(slot) ?? { fin: 0, skip: 0 };
    fin ? hs.fin++ : hs.skip++;
    hour.set(slot, hs);
  }
  const pct = (x: { fin: number; skip: number }) => Math.round((100 * x.fin) / Math.max(1, x.fin + x.skip));
  out.push(`Skip timing: ${buckets.instant} instant (<15 s, tonal clash), ${buckets.early} early (<60 s, wrong direction), ${buckets.late} late (60 s+, fatigue/length — not dislike).`);
  out.push(`Longest unbroken run of finished songs: ${bestRun}.`);
  out.push(`Finish rate by road: ${[...road].map(([k, v]) => `${k} ${pct(v)}% (${v.fin + v.skip})`).join(", ")}.`);
  out.push(`Finish rate by time of day: ${[...hour].map(([k, v]) => `${k} ${pct(v)}% (${v.fin + v.skip})`).join(", ")}.`);
  const ranked = [...artist].filter(([, v]) => v.fin + v.skip >= 2);
  const loved = ranked.filter(([, v]) => v.skip === 0 && v.fin >= 2).sort((a, b) => b[1].fin - a[1].fin).slice(0, 8);
  const rejected = ranked.filter(([, v]) => v.skip >= 2 && v.skip > v.fin).sort((a, b) => b[1].skip - a[1].skip).slice(0, 8);
  if (loved.length) out.push(`Always finished: ${loved.map(([a, v]) => `${a} ${v.fin}/${v.fin}`).join(", ")}.`);
  if (rejected.length) out.push(`Mostly skipped: ${rejected.map(([a, v]) => `${a} ${v.skip}/${v.fin + v.skip}${v.instant ? ` (${v.instant} instant)` : ""}`).join(", ")}.`);
  // Cross-reference with years of streaming history: surprises are the gold.
  const surprises: string[] = [];
  for (const e of events) {
    const h = history.get(`${e.track_name}|${e.artists}`.toLowerCase());
    if (!h) continue;
    if (e.event === "early_skip" && h.plays >= 20) surprises.push(`skipped "${e.track_name}" despite ${h.plays} lifetime plays`);
    if (e.event === "play_through" && h.plays <= 2) surprises.push(`finished rarely-played "${e.track_name}" (${h.plays} lifetime plays)`);
    if (e.event === "play_through" && h.lastYear && Number(h.lastYear) <= new Date().getUTCFullYear() - 3) surprises.push(`finished "${e.track_name}", untouched since ${h.lastYear}`);
  }
  if (surprises.length) out.push(`Against lifetime history: ${[...new Set(surprises)].slice(0, 10).join("; ")}.`);
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

  // Lifetime plays for the tracks involved (from an imported streaming history, if any).
  const history = new Map<string, { plays: number; lastYear: string | null }>();
  const { data: libIds } = await supabase
    .from("library_tracks")
    .select("spotify_id, name, artists")
    .in("name", names.slice(0, 200));
  const idToKey = new Map((libIds ?? []).map((t) => [t.spotify_id, `${t.name}|${t.artists}`.toLowerCase()]));
  if (idToKey.size) {
    const { data: hist } = await supabase
      .from("listening_history")
      .select("spotify_id, plays, last_played")
      .in("spotify_id", [...idToKey.keys()].slice(0, 300));
    for (const h of hist ?? []) {
      const k = idToKey.get(h.spotify_id);
      if (k) history.set(k, { plays: h.plays, lastYear: h.last_played?.slice(0, 4) ?? null });
    }
  }

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

  const { data: profRows } = await supabase
    .from("memory_nodes")
    .select("content")
    .eq("origin", "history_profile")
    .limit(7);
  const profile = (profRows ?? []).map((p) => `- ${p.content}`);

  // Cross-session pass only: stated intents (steers) and prior single-session observations.
  let intents: string[] = [];
  if (opts.scope === "history") {
    const [{ data: steerRows }, { data: obsRows }] = await Promise.all([
      supabase.from("memory_nodes").select("content").eq("origin", "steer").order("created_at", { ascending: false }).limit(30),
      supabase.from("memory_nodes").select("content").eq("origin", "synthesis").order("created_at", { ascending: false }).limit(20),
    ]);
    intents = [
      ...(steerRows ?? []).map((r) => `- [steer] ${r.content}`),
      ...(obsRows ?? []).map((r) => `- [observation] ${r.content}`),
    ];
  }

  const sessions = new Set(events.map((e) => e.session_id)).size;
  const skips = events.filter((e) => e.event === "early_skip").length;
  const plays = events.filter((e) => e.event === "play_through").length;

  const who = opts.displayName?.trim() || "The listener";
  const cross = opts.scope === "history";

  const shared = `How you think — you are a mastermind DJ who learns purely by watching, never by asking:
- The listener is meant to lean back. Silence is the normal state. Every skip is a deliberate act and carries weight; every finished song is a quiet yes (strong when it sits next to active choices, weak inside a long untouched run).
- "Played to the end" means the song really ran to its end, whatever its length. Short and long songs count the same.
- Read skip timing: instant (<15 s) = tonal clash with the song itself; early (<60 s) = the direction was wrong; late (60 s+) = fatigue, length or a mood shift, NOT dislike.
- Reason like a detective before writing: form hypotheses, test each against the trace, the signals, the lifetime history and existing memories. Keep only conclusions that survive. Prefer one sharp, predictive insight over two vague ones.
- Every memory must be ACTIONABLE for picking the next songs: it should tell future-Crate what to play, avoid, or when (e.g. "Late evenings, warm 70s soul survives where modern trap gets skipped within seconds — open nights with soul.").
- If the evidence refines or contradicts an existing memory, write the refined version and say what changed ("no longer…", "only at night…").
- NEVER state something obvious from their playlists ("loves R&B"). Banned.
- Look for: contradictions inside a genre, production texture (drums, bass, reverb, vocals vs instrumental), patience patterns, time-of-day rituals, which roads keep them listening, nostalgia vs exploration, outgrown artists, protected songs, surprises against lifetime history.
- Lines marked UNATTENDED? sit inside a run of ${PASSIVE_STREAK}+ finished songs with zero interaction. Never build a conclusion on those alone.
- Be concrete: name real artists, songs or playlist months.
- Third person, one or two sentences each, warm and specific, English.
- Do not repeat or lightly reword an existing memory.
- Feedbacker notes, if any, are optional hints from the listener. Use them only to confirm a pattern you already see in behaviour; never base a memory on a note alone and never restate one.`;

  const system = cross
    ? `You are Crate, a music companion who has followed ${who} across many separate listening sessions.

Write 1–2 DURABLE taste memories — patterns that hold up across sessions, not moods from one evening.

- Only write a memory you can support with evidence from at least 3 distinct sessions (or a clear, repeated time-of-day ritual). If nothing reaches that bar, return an empty array [].
- Say how the pattern shows across sessions ("across seven sessions", "every session started after 23:00"), and mention taste that has shifted over time when you see it.
- Stated intents (steer requests, Feedbacker notes) and prior session observations may be PROMOTED into a durable memory only when the same direction appears in 3+ distinct sessions AND the listening trace agrees (those songs were played through, not skipped). Words alone never create a memory. When you promote, write the durable version — not a reword of the observation.
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
Behavioural signals (pre-computed):
${signalLines(events, tz, history).join("\n")}

${traceLines(events, meta, tz).join("\n")}
${notes.length ? `\nOptional listener hints (feedbacker notes):\n${notes.join("\n")}` : ""}
${intents.length ? `\nStated intents & prior observations (candidates for promotion — verify against the trace):\n${intents.join("\n")}` : ""}
${profile.length ? `\nLong-term baseline from their years of Spotify streaming history. Evaluate the trace against it: where does this listening confirm, deepen or break the long-term habit? A break (new time of day, a faded artist returning, a usually-skipped artist finished) is a strong memory candidate — say what changed compared to the baseline. Never restate the baseline itself:\n${profile.join("\n")}` : ""}`;

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
        forceReasoning: true,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
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
