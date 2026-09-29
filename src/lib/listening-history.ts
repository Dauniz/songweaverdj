import { unzipSync, strFromU8 } from "fflate";
import { supabase } from "@/integrations/supabase/client";

/** Aggregated plays per Spotify track, parsed in the browser from Spotify / stats.fm history files. */
export type HistoryStat = {
  spotify_id: string;
  plays: number;
  ms_played: number;
  first_played: string;
  last_played: string;
};

type Entry = { ts?: string; endTime?: string; ms_played?: number; msPlayed?: number; spotify_track_uri?: string | null };

const MIN_MS = 30_000; // Spotify's own "counts as a stream" threshold

async function readJsonTexts(files: File[]): Promise<string[]> {
  const texts: string[] = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip")) {
      const unzipped = unzipSync(new Uint8Array(await f.arrayBuffer()), {
        filter: (e) => e.name.toLowerCase().endsWith(".json") && /audio|streaming/i.test(e.name),
      });
      for (const data of Object.values(unzipped)) texts.push(strFromU8(data));
    } else if (f.name.toLowerCase().endsWith(".json")) {
      texts.push(await f.text());
    }
  }
  return texts;
}

export async function parseHistoryFiles(files: File[]) {
  const texts = await readJsonTexts(files);
  const by = new Map<string, HistoryStat>();
  let streams = 0;
  let minYear = 9999;
  let maxYear = 0;
  for (const t of texts) {
    let arr: unknown;
    try {
      arr = JSON.parse(t);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    for (const e of arr as Entry[]) {
      const uri = e.spotify_track_uri;
      const ms = e.ms_played ?? e.msPlayed ?? 0;
      const ts = e.ts ?? e.endTime;
      if (!uri || !uri.startsWith("spotify:track:") || ms < MIN_MS || !ts) continue;
      const id = uri.slice(14);
      const iso = new Date(ts).toISOString();
      const y = Number(iso.slice(0, 4));
      minYear = Math.min(minYear, y);
      maxYear = Math.max(maxYear, y);
      streams++;
      const s = by.get(id);
      if (s) {
        s.plays++;
        s.ms_played += ms;
        if (iso < s.first_played) s.first_played = iso;
        if (iso > s.last_played) s.last_played = iso;
      } else {
        by.set(id, { spotify_id: id, plays: 1, ms_played: ms, first_played: iso, last_played: iso });
      }
    }
  }
  return { stats: [...by.values()], streams, minYear, maxYear };
}

export async function saveHistory(stats: HistoryStat[], onProgress?: (done: number) => void) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  const userId = data.user.id;
  for (let i = 0; i < stats.length; i += 500) {
    const chunk = stats.slice(i, i + 500).map((s) => ({ ...s, user_id: userId }));
    const { error } = await supabase.from("listening_history").upsert(chunk, { onConflict: "user_id,spotify_id" });
    if (error) throw error;
    onProgress?.(Math.min(stats.length, i + 500));
  }
}
