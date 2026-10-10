import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, useReducedMotion } from "motion/react";
import { MOTION_EASE } from "@/lib/motion";
import { readLiveSession } from "@/lib/live-session";
import logo from "@/assets/crate-logo.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Songweaver — a DJ that learns how you listen" },
      {
        name: "description",
        content:
          "Tell Crate how today feels and he builds a path through your own Spotify library — one song at a time, with two doors lined up. What he learns is stored on Walrus Memory, and the music plays in your Spotify app.",
      },
      { property: "og:title", content: "Songweaver — a DJ that learns how you listen" },
      {
        property: "og:description",
        content:
          "Tell Crate how today feels and he builds a path through your own Spotify library. What he learns is stored on Walrus Memory.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  useEffect(() => {
    // Returning users go straight to the studio; the homepage is for
    // newcomers and devices without a saved sign-in.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/studio" });
    });
    if (readLiveSession()) void navigate({ to: "/studio" });
  }, [navigate]);
  return (
    <main className="min-h-screen bg-glow">
      <motion.div
        className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16"
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: reduced ? 0 : 0.07 } } }}
      >
        <motion.img variants={{ hidden: { opacity: 0, y: reduced ? 0 : 10 }, visible: { opacity: 1, y: 0, transition: { duration: reduced ? 0.12 : 0.32, ease: MOTION_EASE } } }} src={logo} alt="Songweaver logo" width={72} height={72} className="h-18 w-18 rounded-2xl" />
        <motion.div variants={{ hidden: { opacity: 0, y: reduced ? 0 : 10 }, visible: { opacity: 1, y: 0, transition: { duration: reduced ? 0.12 : 0.32, ease: MOTION_EASE } } }}>
        <p className="mt-10 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
          The Maze · Walrus Memory
        </p>
        <h1 className="mt-4 max-w-4xl text-[2.75rem] font-extrabold leading-[1.02] md:text-6xl lg:text-7xl">
          Stop curating. Start <span className="text-magenta">listening</span>.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Tell Crate how today feels and he builds a path through your own library — one song at a time, with two
          doors already lined up: one if you let it finish, one if you skip. What he learns from how you listen is
          stored on Walrus, so every session starts sharper than the last.
          The music plays in Spotify, Crate just drives.
        </p>
        <div className="mt-10">
          <Link
            to="/studio"
            className="kinetic-control inline-flex h-12 items-center rounded-full bg-primary px-8 font-semibold text-primary-foreground hover:scale-[1.02]"
          >
            Open the studio
          </Link>
        </div>
        </motion.div>
      </motion.div>
    </main>
  );
}
