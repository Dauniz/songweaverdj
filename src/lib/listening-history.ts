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

type Entry = {
  ts?: string;
  endTime?: string;
  ms_played?: number;
  msPlayed?: number;
  spotify_track_uri?: string | null;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  trackName?: string;
  artistName?: string;
  skipped?: boolean | null;
  reason_end?: string | null;
  shuffle?: boolean | null;
  platform?: string | null;
};

/** Compact behavioural summary of the whole history — what Crate studies to write long-term memories. */
export type HistoryDigest = {
  streams: number;
  hours: number;
  span: string;
  hourOfDay: number[]; // share of streams per local hour 0–23 (%)
  weekday: number[]; // Mon–Sun (%)
  shufflePct: number | null;
  skipPct: number; // plays that ended under 30 s or flagged skipped
  platforms: string[];
  years: { year: number; streams: number; topArtists: string[]; topTracks: string[] }[];
  allTimeArtists: { name: string; plays: number; skipPct: number; lastYear: number }[];
  mostSkippedArtists: { name: string; plays: number; skipPct: number }[];
  protectedTracks: string[]; // many plays, almost never skipped
  fadedArtists: { name: string; peakYear: number; peakPlays: number; lastYear: number }[];
  lateNight: string[]; // artists over-represented 23–04
  bingeDays: { date: string; track: string; plays: number }[];
};

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
  const hourC = new Array(24).fill(0);
  const dayC = new Array(7).fill(0);
  let totalMs = 0;
  let shuf = 0;
  let shufKnown = 0;
  let skipC = 0;
  let all = 0;
  const plat = new Map<string, number>();
  const art = new Map<string, { plays: number; skips: number; years: Map<number, number>; night: number }>();
  const trk = new Map<string, { plays: number; skips: number }>();
  const yearArt = new Map<number, Map<string, number>>();
  const yearTrk = new Map<number, Map<string, number>>();
  const yearC = new Map<number, number>();
  const dayTrk = new Map<string, number>();
  const bump = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
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
      if (!ts) continue;
      const artist = e.master_metadata_album_artist_name ?? e.artistName ?? null;
      const title = e.master_metadata_track_name ?? e.trackName ?? null;
      if (artist && title && ms > 0) {
        const d = new Date(ts);
        const yr = d.getFullYear();
        const skipped = ms < MIN_MS || e.skipped === true || e.reason_end === "fwdbtn";
        const h = d.getHours();
        all++;
        if (skipped) skipC++;
        if (typeof e.shuffle === "boolean") {
          shufKnown++;
          if (e.shuffle) shuf++;
        }
        if (e.platform) bump(plat, e.platform.split(/[ (;]/)[0]!.toLowerCase());
        const a = art.get(artist) ?? { plays: 0, skips: 0, years: new Map(), night: 0 };
        art.set(artist, a);
        const tk = `${title} — ${artist}`;
        const tr = trk.get(tk) ?? { plays: 0, skips: 0 };
        trk.set(tk, tr);
        if (skipped) {
          a.skips++;
          tr.skips++;
        } else {
          a.plays++;
          tr.plays++;
          totalMs += ms;
          hourC[h]++;
          dayC[(d.getDay() + 6) % 7]++;
          bump(a.years, yr);
          if (h >= 23 || h < 4) a.night++;
          bump(yearC, yr);
          bump(yearArt.get(yr) ?? yearArt.set(yr, new Map()).get(yr)!, artist);
          bump(yearTrk.get(yr) ?? yearTrk.set(yr, new Map()).get(yr)!, tk);
          bump(dayTrk, `${d.toISOString().slice(0, 10)}|${tk}`);
        }
      }
      if (!uri || !uri.startsWith("spotify:track:") || ms < MIN_MS) continue;
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
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const top = <K,>(m: Map<K, number>, n: number) => [...m].sort((x, y) => y[1] - x[1]).slice(0, n);
  const hourSum = hourC.reduce((x, y) => x + y, 0);
  const nowYear = new Date().getFullYear();
  const artists = [...art].map(([name, a]) => {
    const ys = [...a.years];
    const peak = ys.sort((x, y) => y[1] - x[1])[0] ?? [0, 0];
    return {
      name,
      plays: a.plays,
      skipPct: pct(a.skips, a.plays + a.skips),
      lastYear: Math.max(0, ...a.years.keys()),
      peakYear: peak[0],
      peakPlays: peak[1],
      night: a.night,
    };
  });
  const nightShare = hourSum ? (hourC.slice(0, 4).reduce((x, y) => x + y, 0) + hourC[23]) / hourSum : 0;
  const digest: HistoryDigest = {
    streams: hourSum,
    hours: Math.round(totalMs / 3_600_000),
    span: `${minYear}–${maxYear}`,
    hourOfDay: hourC.map((c) => pct(c, hourSum)),
    weekday: dayC.map((c) => pct(c, hourSum)),
    shufflePct: shufKnown ? pct(shuf, shufKnown) : null,
    skipPct: pct(skipC, all),
    platforms: top(plat, 3).map(([p]) => p),
    years: [...yearC]
      .sort((x, y) => x[0] - y[0])
      .slice(-12)
      .map(([year, c]) => ({
        year,
        streams: c,
        topArtists: top(yearArt.get(year)!, 6).map(([k]) => k),
        topTracks: top(yearTrk.get(year)!, 4).map(([k]) => k),
      })),
    allTimeArtists: [...artists].sort((x, y) => y.plays - x.plays).slice(0, 25).map(({ name, plays, skipPct, lastYear }) => ({ name, plays, skipPct, lastYear })),
    mostSkippedArtists: artists
      .filter((a) => a.plays >= 5 && a.skipPct >= 40)
      .sort((x, y) => y.skipPct * Math.log(y.plays + 2) - x.skipPct * Math.log(x.plays + 2))
      .slice(0, 10)
      .map(({ name, plays, skipPct }) => ({ name, plays, skipPct })),
    protectedTracks: [...trk]
      .filter(([, t]) => t.plays >= 15 && t.skips / (t.plays + t.skips) < 0.05)
      .sort((x, y) => y[1].plays - x[1].plays)
      .slice(0, 12)
      .map(([k, t]) => `${k} (${t.plays}x)`),
    fadedArtists: artists
      .filter((a) => a.peakPlays >= 40 && nowYear - a.lastYear >= 2)
      .sort((x, y) => y.peakPlays - x.peakPlays)
      .slice(0, 10)
      .map(({ name, peakYear, peakPlays, lastYear }) => ({ name, peakYear, peakPlays, lastYear })),
    lateNight: artists
      .filter((a) => a.plays >= 20 && a.night / a.plays > Math.max(0.3, nightShare * 2))
      .sort((x, y) => y.night - x.night)
      .slice(0, 8)
      .map((a) => a.name),
    bingeDays: top(dayTrk, 6)
      .filter(([, c]) => c >= 8)
      .map(([k, c]) => {
        const [date, track] = k.split("|");
        return { date: date!, track: track!, plays: c };
      }),
  };
  return { stats: [...by.values()], streams, minYear, maxYear, digest };
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
