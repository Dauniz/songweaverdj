// Client-only live log of what Songweaver sends to Spotify and what Spotify reports back.
// Used by the admin-only Spotify logs panel in Studio.
export type SpotifyLogEntry =
  | {
      kind: "send";
      id: number;
      at: number;
      uris: { id: string; name: string }[];
      generation?: number;
      reason?: string;
      positionMs?: number | undefined;
      ackAt?: number;
      status?: string;
    }
  | { kind: "observed"; id: number; at: number; spotifyId: string; name: string; progressMs: number; playing: boolean }
  | { kind: "event"; id: number; at: number; text: string };

type Omit2<T> = T extends unknown ? Omit<T, "id"> : never;

let entries: SpotifyLogEntry[] = [];
let seq = 0;
let lastObserved = "";
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function pushSpotifyLog(e: Omit2<SpotifyLogEntry>): number {
  const id = ++seq;
  entries = [...entries.slice(-199), { ...e, id } as SpotifyLogEntry];
  emit();
  return id;
}

export function ackSpotifySend(id: number, status: string) {
  entries = entries.map((e) => (e.id === id && e.kind === "send" ? { ...e, ackAt: Date.now(), status } : e));
  emit();
}

/** Log only when Spotify's current song changes (or its playing state flips). */
export function observeSpotify(spotifyId: string | null | undefined, name: string, progressMs: number, playing: boolean) {
  const key = `${spotifyId ?? ""}:${playing}`;
  if (!spotifyId || key === lastObserved) return;
  lastObserved = key;
  pushSpotifyLog({ kind: "observed", at: Date.now(), spotifyId, name, progressMs, playing });
}

export function clearSpotifyLog() {
  entries = [];
  lastObserved = "";
  emit();
}

export const spotifyLogStore = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  get: () => entries,
};
