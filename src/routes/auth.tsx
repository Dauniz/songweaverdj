import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { Disc3, Loader2, Music2 } from "lucide-react";
import { createGuestSession, getSpotifyLoginUrl } from "@/lib/auth-entry.functions";
import { syncSpotifyLibrary } from "@/lib/spotify.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import logo from "@/assets/crate-logo.jpg";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Crate" },
      { name: "description", content: "Sign in to Crate, your music rediscovery companion." },
      { property: "og:title", content: "Sign in — Crate" },
      {
        property: "og:description",
        content: "Sign in to Crate, your music rediscovery companion.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<null | "spotify" | "guest">(null);
  const loginUrl = useServerFn(getSpotifyLoginUrl);
  const guestFn = useServerFn(createGuestSession);
  const syncFn = useServerFn(syncSpotifyLibrary);

  async function finishSpotify(tokenHash: string) {
    setEntry("spotify");
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (error) {
      setEntry(null);
      toast.error(error.message);
      return;
    }
    const t = toast.loading("Pulling in your playlists…");
    try {
      const r = await syncFn();
      toast.success(`Imported ${r.imported} tracks`, { id: t });
    } catch {
      toast.error("Signed in, but the playlist sync failed. Try Sync in the Library.", { id: t });
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
    setEntry("spotify");
    try {
      const { url } = await loginUrl({ data: { origin: window.location.origin } });
      const w = window.open(url, "spotify-login", "width=480,height=720");
      if (!w) window.location.href = url;
      setEntry(null);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/studio" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/studio" },
        });
        if (error) throw error;
        if (!data.session) toast.success("Check your email to confirm your account.");
        else navigate({ to: "/studio" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-glow flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card/80 p-8 backdrop-blur">
        <img src={logo} alt="Crate" width={56} height={56} className="mb-6 h-14 w-14 rounded-xl" />
        <h1 className="text-3xl font-bold">{mode === "in" ? "Welcome back" : "Start digging"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your forgotten favorites are waiting.</p>
        <Button onClick={spotify} disabled={entry !== null} size="lg" className="mt-6 w-full">
          {entry === "spotify" ? <Loader2 className="animate-spin" /> : <Music2 />}
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
        <div className="my-4 text-center text-xs text-muted-foreground">or use email</div>
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" disabled={busy} className="w-full">
            {mode === "in" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <button
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
