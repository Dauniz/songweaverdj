import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps a Spotify authorize URL ready ahead of time so the tap opens it
 * synchronously. iOS Safari blocks/throws ("The operation is insecure") when a
 * window is navigated after an async wait, so no await may sit between tap and open.
 */
export function usePreparedSpotifyUrl(fetchUrl: () => Promise<{ url: string }>) {
  const ref = useRef<{ url: string; at: number } | null>(null);
  const fetchRef = useRef(fetchUrl);
  fetchRef.current = fetchUrl;

  const refresh = useCallback(async () => {
    try {
      const { url } = await fetchRef.current();
      ref.current = { url, at: Date.now() };
    } catch {
      /* not configured / not signed in yet — handled on tap */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 10 * 60_000); // state is valid 15 min
    return () => clearInterval(t);
  }, [refresh]);

  const get = useCallback(() => {
    const p = ref.current;
    return p && Date.now() - p.at < 12 * 60_000 ? p.url : null;
  }, []);

  return { get, refresh };
}

/** Open a Spotify authorize URL right inside the user's tap. */
export function openSpotifyAuth(url: string, name: string) {
  const framed = window.top !== window.self;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && !framed) {
    window.location.assign(url);
    return;
  }
  const popup = framed
    ? window.open(url, "_blank")
    : window.open(url, name, "width=520,height=720");
  if (!popup && !framed) window.location.assign(url);
}
