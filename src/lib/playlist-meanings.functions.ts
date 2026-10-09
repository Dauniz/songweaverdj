import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readAllRows, libraryPoolCache } from "@/lib/keyset";

/**
 * Crate reads each playlist name (words and emojis) plus a sample of its songs once, and saves
 * what it means as short mood/scene tags. Only unread playlist names are sent. Renamed = new name.
 */
export const readPlaylistMeanings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { read: 0 };
    const rows = await readAllRows<{ id: string; name: string; artists: string; genres: string | null; source_name: string; source_type: string }>(
      supabase,
      "library_tracks",
      "id, name, artists, genres, source_name, source_type",
      "id",
      userId,
      30000,
    );
    const byList = new Map<string, typeof rows>();
    for (const r of rows) {
      if (r.source_type !== "playlist") continue;
      const l = byList.get(r.source_name) ?? [];
      l.push(r);
      byList.set(r.source_name, l);
    }
    const { data: known } = await supabase.from("playlist_meanings").select("playlist_name").eq("user_id", userId);
    const done = new Set((known ?? []).map((k) => k.playlist_name));
    const todo = [...byList.keys()].filter((n) => !done.has(n)).slice(0, 120);
    if (!todo.length) return { read: 0 };

    let read = 0;
    for (let i = 0; i < todo.length; i += 30) {
      const batch = todo.slice(i, i + 30);
      const lines = batch.map((name, k) => {
        const songs = byList.get(name)!;
        const sample = songs.slice(0, 15).map((s) => `${s.name} — ${s.artists}${s.genres ? ` {${s.genres.split(", ").slice(0, 2).join(", ")}}` : ""}`);
        return `P${k} | "${name}" (${songs.length} songs): ${sample.join("; ")}`;
      });
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          messages: [
            {
              role: "system",
              content:
                "You read a listener's Spotify playlist names. A name — a word, phrase or emoji — says a lot about how they feel about the songs in it. Use what that word or emoji usually means (🌧️ = rainy, melancholic, calm; 🔥 = high energy, hype; 'gym' = workout; a month name = a time capsule) and check it against the sample songs. Return for each playlist one short meaning sentence and 2-5 lowercase mood/scene tags (e.g. 'melancholic', 'high energy', 'summer', 'late night', 'workout'). Use 'time capsule' for purely date-named playlists.",
            },
            { role: "user", content: lines.join("\n") },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "meanings",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["playlists"],
                properties: {
                  playlists: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["code", "meaning", "tags"],
                      properties: { code: { type: "string" }, meaning: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
                    },
                  },
                },
              },
            },
          },
        }),
      });
      if (!res.ok) {
        console.error("playlist meanings failed", res.status, await res.text().catch(() => ""));
        if (res.status === 402 || res.status === 403 || res.status === 429) break;
        continue;
      }
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      let parsed: { playlists: { code: string; meaning: string; tags: string[] }[] } = { playlists: [] };
      try {
        parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
      } catch {
        continue;
      }
      const up = parsed.playlists
        .map((p) => ({ name: batch[Number(p.code.replace(/\D/g, ""))], p }))
        .filter((x): x is { name: string; p: (typeof parsed.playlists)[number] } => !!x.name)
        .map(({ name, p }) => ({
          user_id: userId,
          playlist_name: name,
          meaning: p.meaning.slice(0, 300),
          tags: p.tags.slice(0, 5).map((t) => t.toLowerCase().slice(0, 30)),
        }));
      if (up.length) {
        const { error } = await supabase.from("playlist_meanings").upsert(up);
        if (error) console.error("save playlist meanings failed", error);
        else read += up.length;
      }
    }
    if (read) libraryPoolCache.delete(userId);
    return { read };
  });
