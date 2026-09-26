import { createHmac, timingSafeEqual } from "node:crypto";

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-read-recently-played",
  "user-top-read",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

export function spotifyCreds() {
  const clientId = process.env["SPOTIFY_CLIENT_ID"];
  const clientSecret = process.env["SPOTIFY_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function stateSecret() {
  return process.env["SPOTIFY_CLIENT_SECRET"] ?? "";
}

export function signState(userId: string, returnOrigin: string) {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, o: returnOrigin, t: Date.now() }),
  ).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(state: string) {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    u: string;
    o: string;
    t: number;
  };
  if (Date.now() - data.t > 15 * 60 * 1000) return null;
  return data;
}

export async function exchangeToken(body: Record<string, string>) {
  const creds = spotifyCreds();
  if (!creds) throw new Error("Spotify is not configured");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Spotify token error [${res.status}]: ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

type SpotifyTrack = {
  id: string | null;
  name: string;
  artists: { name: string }[];
  album?: { name: string; images?: { url: string }[] };
  preview_url?: string | null;
  external_urls?: { spotify?: string };
  is_local?: boolean;
};

export type IngestRow = {
  spotify_id: string;
  name: string;
  artists: string;
  album: string | null;
  image_url: string | null;
  preview_url: string | null;
  spotify_url: string | null;
  source_type: string;
  source_name: string;
  source_period: string | null;
};

export function toRow(
  t: SpotifyTrack | null | undefined,
  source_type: string,
  source_name: string,
  source_period: string | null,
): IngestRow | null {
  if (!t || !t.id || t.is_local) return null;
  return {
    spotify_id: t.id,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(", "),
    album: t.album?.name ?? null,
    image_url: t.album?.images?.[0]?.url ?? null,
    preview_url: t.preview_url ?? null,
    spotify_url: t.external_urls?.spotify ?? null,
    source_type,
    source_name,
    source_period,
  };
}

export async function spotifyGet<T>(token: string, path: string): Promise<T> {
  const url = path.startsWith("http") ? path : `https://api.spotify.com/v1${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429 && attempt < 4) {
      const wait = Math.min(Number(res.headers.get("retry-after") ?? 0) * 1000 || 1500 * 2 ** attempt, 15_000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 429) {
      throw new Error("Spotify is limiting requests right now. Wait a few minutes and try syncing again.");
    }
    if (!res.ok) throw new Error(`Spotify API error [${res.status}] ${path}: ${await res.text()}`);
    return (await res.json()) as T;
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Try to read a month/year out of playlist names like "Oct 2024", "october '23", "2024-10". */
export function guessPeriod(name: string): string | null {
  const n = name.toLowerCase();
  const iso = n.match(/\b(20\d{2})[-/. ](\d{1,2})\b/);
  if (iso) {
    const m = Number(iso[2]);
    if (m >= 1 && m <= 12) return `${iso[1]}-${String(m).padStart(2, "0")}-01`;
  }
  let month = -1;
  FULL.forEach((m, i) => {
    if (month < 0 && n.includes(m)) month = i;
  });
  if (month < 0)
    MONTHS.forEach((m, i) => {
      if (month < 0 && new RegExp(`\\b${m}\\b`).test(n)) month = i;
    });
  const y4 = n.match(/\b(20\d{2})\b/);
  const y2 = n.match(/['’](\d{2})\b/);
  const year = y4 ? Number(y4[1]) : y2 ? 2000 + Number(y2[1]) : null;
  if (month >= 0 && year) return `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return null;
}
