import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { readLiveSession } from "@/lib/live-session";
import logo from "@/assets/crate-logo.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Songweaver — Rediscover the music you already love" },
      {
        name: "description",
        content:
          "An AI music companion that resurfaces buried favorites from your monthly Spotify playlists, powered by Walrus Memory.",
      },
      { property: "og:title", content: "Songweaver — Rediscover the music you already love" },
      {
        property: "og:description",
        content: "Tell Crate, Songweaver's AI companion, your vibe and rediscover forgotten gems.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    if (readLiveSession()) void navigate({ to: "/studio" });
  }, [navigate]);
  return (
    <main className="min-h-screen bg-glow">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <img src={logo} alt="Songweaver logo" width={72} height={72} className="h-18 w-18 rounded-2xl" />
        <p className="mt-10 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
          Personal rediscovery · Walrus Memory
        </p>
        <h1 className="mt-4 max-w-3xl text-5xl font-extrabold leading-[1.02] md:text-7xl">
          Your best songs are buried in <span className="text-magenta">Oct 2024</span>.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Tell Crate, Songweaver's AI, how today feels — late-night coding, nostalgic drive, rainy focus — and it digs
          through every monthly playlist you've ever made to bring back the tracks you forgot you
          loved. It remembers your taste on Walrus, so every session gets sharper.
        </p>
        <div className="mt-10">
          <Link
            to="/studio"
            className="inline-flex h-12 items-center rounded-full bg-primary px-8 font-semibold text-primary-foreground transition hover:scale-[1.02]"
          >
            Open the studio
          </Link>
        </div>
      </div>
    </main>
  );
}
