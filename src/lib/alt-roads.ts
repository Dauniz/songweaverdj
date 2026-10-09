/**
 * Alternative roads (Wormhole, Texture, Deep cuts, Scene). When one is on it replaces the
 * default roads: plain code narrows the whole library to ~15 relevant songs, then the AI picks one.
 * The skip ladder is read from the trailing skips in the history.
 */

import { isForgotten } from "./pick-rules";

export type AltSong = {
  spotify_id: string;
  artists: string;
  genres: string | null;
  source_period: string | null;
  sources: { name: string; type: string; period: string | null }[];
  plays?: number;
  last_played?: string | null;
  first_played?: string | null;
  plays_by_year?: Record<string, number> | null;
};

export type AltKind = "wormhole" | "texture" | "deep" | "scene";

const TEXTURES: [string, RegExp][] = [
  ["piano", /piano|classical|neoclassical|neo-classical|compositional/],
  ["ambient", /ambient|drone|new age|lo-fi|lofi|chillhop|sleep/],
  ["acoustic", /acoustic|folk|singer-songwriter|americana|bluegrass|country/],
  ["electronic", /electro|house|techno|edm|trance|dubstep|drum and bass|dnb|synth|dance|garage|disco|hyperpop/],
  ["hip-hop", /hip hop|rap|trap|drill|grime/],
  ["rock", /rock|metal|punk|grunge|emo|hardcore|shoegaze/],
  ["jazz & soul", /jazz|soul|r&b|funk|blues|gospel/],
  ["pop", /pop/],
];

export function textureOf(s: { genres: string | null }) {
  if (!s.genres) return null;
  const g = s.genres.toLowerCase();
  for (const [name, re] of TEXTURES) if (re.test(g)) return name;
  return null;
}

const hasYears = (s: AltSong) => !!s.plays_by_year && Object.keys(s.plays_by_year).length > 0;

/** Wormhole: each year it was streamed counts min(plays, 25) + 4; 27 points = a song you keep returning to. */
export function wormholeScore(s: AltSong) {
  if (!s.plays_by_year) return 0;
  let score = 0;
  for (const n of Object.values(s.plays_by_year)) if (n > 0) score += Math.min(n, 25) + 4;
  return score;
}

const distinctPlaylists = (s: AltSong) => new Set(s.sources.filter((x) => x.type === "playlist").map((x) => x.name)).size;

/** Era of a song: its peak streaming year, else first play, else the year it was saved. */
export function eraOf(s: AltSong): number | null {
  if (hasYears(s)) {
    const top = Object.entries(s.plays_by_year!).sort((a, b) => b[1] - a[1])[0];
    if (top) return Number(top[0]);
  }
  const d = s.first_played ?? s.source_period ?? s.sources.find((x) => x.period)?.period ?? null;
  return d ? Number(d.slice(0, 4)) : null;
}

/** Deep cut from history = a forgotten favorite (20+ streams, ≤3 in the last 6 months). */
const isDeepFromHistory = (s: AltSong) => isForgotten(s);

/** Fallback without history: saved over a year ago and in only one place. */
function isDeepFromSaves(s: AltSong) {
  if (s.sources.length > 1) return false;
  const p = s.sources[0]?.period;
  return !!p && Date.now() - new Date(p + "T00:00:00Z").getTime() > 365 * 86_400_000;
}

export const artistsOf = (s: { artists: string }) => s.artists.split(", ").map((a) => a.trim()).filter(Boolean);

/** Songs allowed on the road at all (no ladder) — used for reserves. */
export function altPool<T extends AltSong>(kind: AltKind, pool: T[]): { songs: T[]; fallback: boolean } {
  const history = pool.some(hasYears);
  if (kind === "wormhole") {
    if (history) return { songs: pool.filter((s) => wormholeScore(s) >= 27), fallback: false };
    return { songs: pool.filter((s) => distinctPlaylists(s) >= 2), fallback: true };
  }
  if (kind === "deep") {
    if (pool.some((s) => (s.plays ?? 0) > 0)) return { songs: pool.filter(isDeepFromHistory), fallback: false };
    return { songs: pool.filter(isDeepFromSaves), fallback: true };
  }
  if (kind === "texture") return { songs: pool.filter((s) => textureOf(s)), fallback: false };
  return { songs: pool, fallback: false };
}

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

export type AltPlan<T> = { list: T[]; label: string; rule: string };

/**
 * Build the ~15-song shortlist for an alternative road.
 * @param current the song whose outcome opens this door (texture / era reference)
 * @param anchor  last song played through (Scene's original artist)
 * @param skips   skips in a row including the one that opens this door (0 = finish)
 */
export function planAltRoad<T extends AltSong>(
  kind: AltKind,
  pool: T[],
  available: T[],
  current: T | undefined,
  anchor: T | undefined,
  skips: number,
): AltPlan<T> {
  const N = 15;
  const { songs, fallback } = altPool(kind, available);

  if (kind === "wormhole") {
    return {
      list: shuffle(songs).slice(0, N),
      label: fallback ? "Wormhole (no history)" : "Wormhole",
      rule: "ALTERNATIVE ROAD Wormhole: every candidate is a song this listener keeps returning to across the years. Pick the one that fits best after the songs they just played; finish or skip, stay among these returners.",
    };
  }

  if (kind === "texture") {
    const tex = current ? textureOf(current) : null;
    const shift = skips >= 2 && skips % 2 === 0;
    let target = tex;
    if (shift || !tex) {
      const counts = new Map<string, number>();
      for (const s of songs) {
        const t = textureOf(s)!;
        if (t !== tex) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const options = [...counts].filter(([, n]) => n >= 3).map(([t]) => t);
      target = shift ? (shuffle(options)[0] ?? tex) : tex;
    }
    const list = target ? songs.filter((s) => textureOf(s) === target) : songs;
    return {
      list: shuffle(list).slice(0, N),
      label: `Texture · ${target ?? "mixed"}`,
      rule: `ALTERNATIVE ROAD Texture (${target ?? "any"}): ${shift ? "the last texture didn't land, so this is a NEW texture. " : ""}Keep the same sonic texture — instruments, production and sound surface — as ${shift ? "the candidates" : "the current song"}, regardless of era or mood.`,
    };
  }

  if (kind === "deep") {
    const era = current ? eraOf(current) : null;
    const shift = skips >= 2 && skips % 2 === 0;
    const withEra = songs.map((s) => ({ s, e: eraOf(s) })).filter((x) => x.e !== null) as { s: T; e: number }[];
    let list: T[];
    let label = "Deep cuts";
    if (era === null) list = songs;
    else if (shift) {
      const others = [...new Set(withEra.map((x) => x.e).filter((e) => Math.abs(e - era) >= 2))];
      const pickEra = shuffle(others)[0];
      list = pickEra === undefined ? songs : withEra.filter((x) => x.e === pickEra).map((x) => x.s);
      if (pickEra !== undefined) label = `Deep cuts · ${pickEra}`;
    } else {
      list = withEra.filter((x) => Math.abs(x.e - era) <= 1).map((x) => x.s);
      if (list.length < 3) list = withEra.sort((a, b) => Math.abs(a.e - era) - Math.abs(b.e - era)).slice(0, 30).map((x) => x.s);
      label = `Deep cuts · ${era}`;
    }
    if (fallback) label += " (no history)";
    return {
      list: shuffle(list).slice(0, N),
      label,
      rule: `ALTERNATIVE ROAD Deep cuts: every candidate is a forgotten favorite: 20+ streams but barely played in the last 6 months. ${shift ? "The last era didn't land — this is a new era. " : "Stay in the same era. "}Pick the one most likely to bring a forgotten favorite back.`,
    };
  }

  // Scene
  const origin = anchor ? artistsOf(anchor)[0] : current ? artistsOf(current)[0] : undefined;
  if (!origin) return { list: shuffle(available).slice(0, N), label: "Scene", rule: "ALTERNATIVE ROAD Scene: follow the artist web." };
  const co = new Map<string, number>();
  for (const s of pool) {
    const as = artistsOf(s);
    if (!as.includes(origin)) continue;
    for (const a of as) if (a !== origin) co.set(a, (co.get(a) ?? 0) + 1);
  }
  const ranked = [...co].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const by = (a: string) => available.filter((s) => artistsOf(s).includes(a));
  const curArtists = new Set(current ? artistsOf(current) : []);

  if (skips === 0) {
    const list = [...shuffle(by(origin)).slice(0, 8)];
    for (const a of ranked.slice(0, 6)) list.push(...shuffle(by(a)).slice(0, 2));
    return {
      list: [...new Set(list)].slice(0, N),
      label: `Scene · ${origin}`,
      rule: `ALTERNATIVE ROAD Scene around ${origin}: songs by ${origin}, their collaborators and featured artists. Keep the artist web going.`,
    };
  }
  if (skips === 1) {
    let list = by(origin);
    let who = origin;
    if (!list.length) for (const a of ranked) if ((list = by(a)).length) { who = a; break; }
    return {
      list: shuffle(list).slice(0, N),
      label: `Scene · ${who}`,
      rule: `ALTERNATIVE ROAD Scene: back to ${who}${who !== origin ? ` (closest collaborator of ${origin})` : ""}. Pick their best fit.`,
    };
  }
  if (skips <= 3) {
    for (const a of ranked) {
      if (curArtists.has(a)) continue;
      const own = by(a).filter((s) => !artistsOf(s).includes(origin));
      const list = own.length ? own : by(a);
      if (list.length)
        return {
          list: shuffle(list).slice(0, N),
          label: `Scene · ${a}`,
          rule: `ALTERNATIVE ROAD Scene: branch to ${a}, featured with ${origin}. Pick ${a}'s best fit.`,
        };
    }
  }
  // New angle: a new original artist, ideally from the same regional scene (shared genre tags).
  const tags = (s: AltSong) => new Set((s.genres ?? "").toLowerCase().split(/,\s*/).filter(Boolean));
  const originTags = new Set<string>();
  for (const s of by(origin).concat(pool.filter((s) => artistsOf(s)[0] === origin).slice(0, 5))) for (const t of tags(s)) originTags.add(t);
  const skip = new Set([origin, ...ranked, ...curArtists]);
  const scored = available
    .filter((s) => !artistsOf(s).some((a) => skip.has(a)))
    .map((s) => {
      let n = 0;
      for (const t of tags(s)) if (originTags.has(t)) n++;
      return { s, n: n + Math.random() * 0.5 };
    })
    .sort((a, b) => b.n - a.n);
  return {
    list: scored.slice(0, N).map((x) => x.s),
    label: "Scene · new angle",
    rule: `ALTERNATIVE ROAD Scene — NEW ANGLE: ${origin}'s web didn't land. Pick a new artist from the same regional scene (shared genres, country or local scene as ${origin}) to become the new centre.`,
  };
}
