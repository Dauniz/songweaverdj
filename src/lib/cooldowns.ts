// Skip cooldowns: skipped songs/artists rest for a couple of sessions, never forever.
export type CooldownEvent = {
  track_name: string | null;
  artists: string | null;
  event: string;
  session_id: string | null;
  created_at: string;
};
export type Cooldowns = {
  songs: { name: string; artists: string; sessionsLeft: number }[];
  artists: { artists: string; sessionsLeft: number }[];
};

export const SONG_SKIPS = 2; // early skips of one song...
export const SONG_WINDOW = 3; // ...within the last 3 sessions
export const SONG_REST = 2; // rest for the next 2 sessions
export const EXPLICIT_REST = 3; // "Don't suggest this again"
export const ARTIST_SKIPS = 3; // early skips of one artist in one session
export const ARTIST_REST = 2;

export const songKey = (name: string, artists: string) => `${name.toLowerCase()}|${artists.toLowerCase()}`;

/** Sessions are ranked newest first (0 = most recent). A rest of N covers N sessions after the skip. */
export function computeCooldowns(events: CooldownEvent[]): Cooldowns {
  const firstAt = new Map<string, string>();
  for (const e of events) {
    if (!e.session_id) continue;
    const f = firstAt.get(e.session_id);
    if (!f || e.created_at < f) firstAt.set(e.session_id, e.created_at);
  }
  const rank = new Map([...firstAt.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([id], i) => [id, i]));
  const sorted = [...events].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  const songs = new Map<string, { name: string; artists: string; skips: number[]; explicit: number | null }>();
  const artistSession = new Map<string, number>(); // artist|rank -> skips
  for (const e of sorted) {
    if (!e.track_name || !e.session_id) continue;
    const r = rank.get(e.session_id);
    if (r === undefined) continue;
    const artists = e.artists ?? "";
    const k = songKey(e.track_name, artists);
    const s = songs.get(k) ?? { name: e.track_name, artists, skips: [], explicit: null };
    if (e.event === "play_through" || e.event === "explicit_fav") {
      s.skips = [];
      s.explicit = null; // played through again: off cooldown right away
    } else if (e.event === "early_skip") {
      s.skips.push(r);
      const ak = `${artists}|${r}`;
      artistSession.set(ak, (artistSession.get(ak) ?? 0) + 1);
    } else if (e.event === "explicit_skip") {
      s.explicit = r;
    }
    songs.set(k, s);
  }

  const outSongs: Cooldowns["songs"] = [];
  for (const s of songs.values()) {
    let left = 0;
    const recent = s.skips.filter((r) => r < SONG_WINDOW);
    if (recent.length >= SONG_SKIPS) left = SONG_REST - Math.min(...recent);
    if (s.explicit !== null) left = Math.max(left, EXPLICIT_REST - s.explicit);
    if (left > 0) outSongs.push({ name: s.name, artists: s.artists, sessionsLeft: left });
  }
  const outArtists = new Map<string, number>();
  for (const [ak, n] of artistSession) {
    if (n < ARTIST_SKIPS) continue;
    const i = ak.lastIndexOf("|");
    const artists = ak.slice(0, i);
    const left = ARTIST_REST - Number(ak.slice(i + 1));
    if (left > 0 && artists) outArtists.set(artists, Math.max(outArtists.get(artists) ?? 0, left));
  }
  return {
    songs: outSongs,
    artists: [...outArtists].map(([artists, sessionsLeft]) => ({ artists, sessionsLeft })),
  };
}

/** Old permanent skip memories ("Skipped … don't resurface", "Isn't feeling …") are ignored. */
export const isForeverSkipMemory = (text: string, kind?: string | null) =>
  kind === "skipped" || /^(Skipped "|Isn't feeling )/.test(text.trim());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadCooldowns(supabase: any): Promise<Cooldowns> {
  const since = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
  const { data } = await supabase
    .from("listening_events")
    .select("track_name, artists, event, session_id, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(3000);
  return computeCooldowns((data ?? []) as CooldownEvent[]);
}
