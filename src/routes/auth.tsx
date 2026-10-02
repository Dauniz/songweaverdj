import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MOTION_EASE } from "@/lib/motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { Disc3, Loader2 } from "lucide-react";
import { createGuestSession, getSpotifyLoginUrl } from "@/lib/auth-entry.functions";
import { Button } from "@/components/ui/button";
import { openSpotifyAuth, usePreparedSpotifyUrl } from "@/lib/spotify-open";
import logo from "@/assets/crate-logo.jpg";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Songweaver" },
      { name: "description", content: "Sign in to Songweaver, your music rediscovery companion." },
      { property: "og:title", content: "Sign in — Songweaver" },
      {
        property: "og:description",
        content: "Sign in to Songweaver, your music rediscovery companion.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function SpotifyLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.56.3z" />
    </svg>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const [entry, setEntry] = useState<null | "spotify" | "guest">(null);
  const reduced = useReducedMotion();
  const loginUrl = useServerFn(getSpotifyLoginUrl);
  const guestFn = useServerFn(createGuestSession);
  const preparedLogin = usePreparedSpotifyUrl(() =>
    loginUrl({ data: { origin: window.location.origin } }),
  );

  async function finishSpotify(tokenHash: string) {
    setEntry("spotify");
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (error) {
      setEntry(null);
      toast.error(error.message);
      return;
    }
    navigate({ to: "/studio" });
  }

  useEffect(() => {
    const th = new URLSearchParams(window.location.search).get("th");
    if (th) {
      window.history.replaceState(null, "", "/auth");
      void finishSpotify(th);
    } else {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) navigate({ to: "/studio" });
      });
    }
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "spotify-login" && typeof e.data.tokenHash === "string")
        void finishSpotify(e.data.tokenHash);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function spotify() {
    const ready = preparedLogin.get();
    if (ready) {
      openSpotifyAuth(ready, "spotify-login");
      return;
    }
    setEntry("spotify");
    try {
      const { url } = await loginUrl({ data: { origin: window.location.origin } });
      window.location.assign(url);
    } catch (e) {
      setEntry(null);
      toast.error(e instanceof Error ? e.message : "Spotify sign-in failed");
    }
  }

  async function guest() {
    setEntry("guest");
    try {
      const creds = await guestFn();
      const { error } = await supabase.auth.signInWithPassword(creds);
      if (error) throw error;
      navigate({ to: "/studio" });
    } catch (e) {
      setEntry(null);
      toast.error(e instanceof Error ? e.message : "Couldn't start guest mode");
    }
  }

  return (
    <div className="min-h-screen bg-glow flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: reduced ? 0 : 12, clipPath: reduced ? "none" : "inset(0 0 12% 0)" }}
        animate={{ opacity: 1, y: 0, clipPath: "inset(0)" }}
        transition={{ duration: reduced ? 0.12 : 0.36, ease: MOTION_EASE }}
        className="w-full max-w-sm rounded-2xl border bg-card/80 p-8 backdrop-blur"
      >
        <img src={logo} alt="Songweaver" width={56} height={56} className="mb-6 h-14 w-14 rounded-xl" />
        <h1 className="text-3xl font-bold">Welcome to Songweaver</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your forgotten favorites are waiting.</p>
        <Button onClick={spotify} disabled={entry !== null} size="lg" className="mt-6 w-full">
          {entry === "spotify" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <SpotifyLogo className="h-5 w-5" />
          )}
          Continue with Spotify
        </Button>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          Signs you in and imports your playlists.
        </p>
        <Button
          onClick={guest}
          disabled={entry !== null}
          variant="outline"
          size="lg"
          className="mt-3 w-full"
        >
          {entry === "guest" ? <Loader2 className="animate-spin" /> : <Disc3 />}
          Try Demo Library
        </Button>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          Guest mode with sample playlists — no Spotify needed.
        </p>
      </motion.div>
    </div>
  );
}
