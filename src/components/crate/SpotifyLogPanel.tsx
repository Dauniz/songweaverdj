import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearSpotifyLog, spotifyLogStore } from "@/lib/spotify-log";

const EMPTY: never[] = [];
const fmt = (t: number) => {
  const d = new Date(t);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

/** Admin-only live log of URI lists sent to Spotify and when Spotify reports them playing. */
export function SpotifyLogPanel() {
  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(true);
  const entries = useSyncExternalStore(spotifyLogStore.subscribe, spotifyLogStore.get, () => EMPTY);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin");
      if (alive) setAdmin(Boolean(data?.length));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!admin) return null;
  const list = [...entries].reverse();
  const sends = entries.filter((e) => e.kind === "send");

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 font-mono text-xs text-foreground backdrop-blur">
      <div className="flex items-center gap-3 px-3 py-1.5">
        <button onClick={() => setOpen((o) => !o)} className="font-semibold text-primary">
          {open ? "▾" : "▸"} Spotify live log (admin)
        </button>
        <span className="text-muted-foreground">{sends.length} lists sent · {entries.length} events</span>
        <button onClick={clearSpotifyLog} className="ml-auto text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>
      {open && (
        <div className="max-h-56 overflow-y-auto px-3 pb-2">
          {list.length === 0 && <div className="text-muted-foreground">Nothing sent yet — start a session.</div>}
          {list.map((e) => (
            <div key={e.id} className="border-t border-border/50 py-1">
              <span className="text-muted-foreground">{fmt(e.at)} </span>
              {e.kind === "send" && (
                <>
                  <span className="text-primary">SEND</span>
                  {e.generation ? <span className="text-muted-foreground"> g{e.generation}{e.reason ? ` · ${e.reason}` : ""}</span> : null}
                  {e.positionMs ? <span className="text-muted-foreground"> @{(e.positionMs / 1000).toFixed(1)}s</span> : null}
                  <span className="text-muted-foreground">
                    {" "}→ {e.ackAt ? `${e.status} in ${e.ackAt - e.at} ms` : "waiting…"}
                  </span>
                  <ol className="ml-4 list-decimal text-foreground/80">
                    {e.uris.map((u, i) => (
                      <li key={u.id + i}>
                        <span className="text-muted-foreground">{["now", "if you skip"][i] ?? `#${i}`}:</span> {u.name}{" "}
                        <span className="text-muted-foreground">spotify:track:{u.id}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {e.kind === "observed" && (
                <>
                  <span className="text-accent-foreground">SPOTIFY</span>{" "}
                  {e.playing ? "playing" : "paused on"} {e.name}{" "}
                  <span className="text-muted-foreground">at {(e.progressMs / 1000).toFixed(1)}s</span>
                </>
              )}
              {e.kind === "event" && <span className="text-destructive">{e.text}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
