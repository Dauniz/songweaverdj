import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ChevronDown, Headphones, History, Clock } from "lucide-react";
import { useState } from "react";
import { getCrateKnows, type CrateKnows } from "@/lib/crate-knows.functions";
import { geometricEnter, reducedFade, staggerChildren } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/assets/crate-logo.jpg";

export const Route = createFileRoute("/_authenticated/crate-knows")({
  head: () => ({
    meta: [
      { title: "What Crate knows about you — Songweaver" },
      { name: "description", content: "A summary of everything Crate has learned about your listening." },
      { property: "og:title", content: "What Crate knows about you — Songweaver" },
      { property: "og:description", content: "A summary of everything Crate has learned about your listening." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CrateKnowsPage,
});

const fmt = (d: string) => new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

function CrateKnowsPage() {
  const fetchKnows = useServerFn(getCrateKnows);
  const reduced = useReducedMotion();
  const [hintsOpen, setHintsOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["crate-knows"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<CrateKnows> => {
      const key = `songweaver-knows-${new Date().toDateString()}`;
      const cached = sessionStorage.getItem(key);
      if (cached) return JSON.parse(cached) as CrateKnows;
      const res = await fetchKnows();
      sessionStorage.setItem(key, JSON.stringify(res));
      return res;
    },
  });
  const insights = data?.learned.filter((m) => m.kind !== "skipped") ?? [];
  const back = (n: number) => (n === 1 ? "back next session" : `back in ${n} sessions`);
  const avoided = [
    ...(data?.resting?.songs ?? []).map((x) => ({ id: `s:${x.name}|${x.artists}`, content: `"${x.name}" by ${x.artists} — ${back(x.sessionsLeft)}` })),
    ...(data?.resting?.artists ?? []).map((x) => ({ id: `a:${x.artists}`, content: `${x.artists} (played less often) — ${back(x.sessionsLeft)}` })),
  ];
  const [avoidOpen, setAvoidOpen] = useState(false);
  const item = reduced ? reducedFade : geometricEnter;
  const little = data && data.learned.length + data.history.length < 3;

  return (
    <div className="min-h-dvh bg-background bg-glow">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground">
          <Link to="/studio"><ArrowLeft className="h-4 w-4" /> Back to Studio</Link>
        </Button>
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="h-10 w-10 rounded-lg" />
          <h1 className="font-display text-3xl font-bold sm:text-4xl">What Crate knows about you</h1>
        </div>

        {isLoading && <p className="mt-8 animate-pulse text-muted-foreground">Crate is gathering his thoughts…</p>}
        {error && <p className="mt-8 text-destructive">Couldn't load this right now. Try again in a moment.</p>}

        {data && (
          <motion.div initial="hidden" animate="visible" variants={staggerChildren} className="mt-8 space-y-10">
            <motion.p variants={item} className="text-lg leading-relaxed text-foreground/90">
              {data.portrait ?? (little
                ? "We've only just started. Listen a few sessions with me and I'll start noticing what moves you."
                : "Here's what I've picked up so far.")}
            </motion.p>
            <motion.p variants={item} className="text-sm text-muted-foreground">
              Based on {data.sessions} listening session{data.sessions === 1 ? "" : "s"} together.
            </motion.p>

            <motion.section variants={item} className="rounded-2xl border border-primary/40 bg-primary/5 p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-display text-xl font-bold">
                <Headphones className="h-5 w-5 text-primary" /> Figured out by listening with you
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Things Crate only knows from hours of sessions alongside you.</p>
              {insights.length ? (
                <ul className="mt-4 space-y-3">
                  {insights.map((m) => (
                    <li key={m.id} className="rounded-lg border bg-surface p-3">
                      <p className="text-sm leading-relaxed">{m.content}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">First noticed {fmt(m.created_at)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Nothing yet. Keep listening and let Crate steer the flow.</p>
              )}
            </motion.section>

            {avoided.length > 0 && (
              <motion.section variants={item}>
                <button type="button" onClick={() => setAvoidOpen((o) => !o)} className="flex items-center gap-2 text-sm font-semibold text-muted-foreground" aria-expanded={avoidOpen}>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", avoidOpen && "rotate-180")} />
                  Resting for now ({avoided.length})
                </button>
                {avoidOpen && (
                  <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    {avoided.map((m) => <li key={m.id}>• {m.content}</li>)}
                  </ul>
                )}
              </motion.section>
            )}

            {data.rhythms.length > 0 && (
              <motion.section variants={item}>
                <h2 className="flex items-center gap-2 font-display text-xl font-bold">
                  <Clock className="h-5 w-5 text-primary" /> Your rhythms
                </h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.rhythms.map((r) => (
                    <span key={r.text} className={cn("rounded-full border px-3 py-1.5 text-sm", r.source === "sessions" ? "border-primary/40 bg-primary/10" : "bg-surface text-muted-foreground")}>
                      {r.text}
                      <span className="ml-2 text-[10px] uppercase tracking-wide opacity-70">{r.source === "sessions" ? "learned" : "history"}</span>
                    </span>
                  ))}
                </div>
              </motion.section>
            )}

            {data.history.length > 0 && (
              <motion.section variants={item}>
                <h2 className="flex items-center gap-2 text-base font-semibold text-muted-foreground">
                  <History className="h-4 w-4" /> From your streaming history · known before we met
                </h2>
                <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  {data.history.map((m) => <li key={m.id}>• {m.content}</li>)}
                </ul>
              </motion.section>
            )}

            {data.hints.length > 0 && (
              <motion.section variants={item}>
                <button type="button" onClick={() => setHintsOpen((o) => !o)} className="flex items-center gap-2 text-sm font-semibold text-muted-foreground" aria-expanded={hintsOpen}>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", hintsOpen && "rotate-180")} />
                  Still testing ({data.hints.length})
                </button>
                {hintsOpen && (
                  <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    {data.hints.map((m) => <li key={m.id}>• {m.content}</li>)}
                  </ul>
                )}
              </motion.section>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
