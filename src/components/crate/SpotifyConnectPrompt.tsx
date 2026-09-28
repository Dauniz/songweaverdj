import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Disc3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getSpotifyAuthUrl, getSpotifyStatus } from "@/lib/spotify.functions";
import { openSpotifyAuth, usePreparedSpotifyUrl } from "@/lib/spotify-open";

/** Asks to connect Spotify on entry (or right after onboarding) so Crate can follow what you play. */
export function SpotifyConnectPrompt() {
  const statusFn = useServerFn(getSpotifyStatus);
  const authUrlFn = useServerFn(getSpotifyAuthUrl);
  const { data: status } = useQuery({ queryKey: ["spotify-status"], queryFn: () => statusFn() });
  const prepared = usePreparedSpotifyUrl(() => authUrlFn({ data: { origin: window.location.origin } }));
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [tourRunning, setTourRunning] = useState(false);

  useEffect(() => {
    const opened = () => setTourRunning(true);
    const done = () => {
      setTourRunning(false);
      setOpen(true);
    };
    window.addEventListener("songweaver-onboarding-open-spotify", opened);
    window.addEventListener("songweaver-onboarding-done", done);
    return () => {
      window.removeEventListener("songweaver-onboarding-open-spotify", opened);
      window.removeEventListener("songweaver-onboarding-done", done);
    };
  }, []);

  // Returning users: only ask when Spotify isn't linked.
  useEffect(() => {
    if (status?.configured && !status.connected) setOpen(true);
  }, [status?.configured, status?.connected]);

  // After onboarding, a user who is already linked just gets a short confirmation.
  useEffect(() => {
    if (open && status?.connected) {
      setOpen(false);
      toast.success("Spotify connected — ask Crate for a vibe, search a song, or press play in Spotify.");
    }
  }, [open, status?.connected]);

  if (!open || dismissed || tourRunning || !status?.configured || status.connected) return null;

  return (
    <div className="fixed inset-x-3 bottom-4 z-50 mx-auto max-w-sm rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Disc3 className="h-4 w-4 text-primary" /> Connect Crate to Spotify
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        So Crate can follow what you play. Once connected, a prompt, a search or pressing play in Spotify starts a session.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>Not now</Button>
        <Button
          size="sm"
          onClick={() => {
            const url = prepared.get();
            if (url) openSpotifyAuth(url, "spotify-auth");
            else void authUrlFn({ data: { origin: window.location.origin } }).then(({ url }) => window.location.assign(url));
          }}
        >
          Connect
        </Button>
      </div>
    </div>
  );
}
