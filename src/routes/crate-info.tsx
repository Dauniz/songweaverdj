import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Brain, Database, Route as RouteIcon, Sparkles } from "lucide-react";

export const Route = createFileRoute("/crate-info")({
  head: () => ({
    meta: [
      { title: "How Crate uses Walrus — Songweaver" },
      {
        name: "description",
        content:
          "Crate is Songweaver's AI companion. It reads your listening as a maze and writes what it learns to Walrus Memory — here is exactly how.",
      },
      { property: "og:title", content: "How Crate uses Walrus — Songweaver" },
      {
        property: "og:description",
        content:
          "Crate is Songweaver's AI companion. It reads your listening as a maze and writes what it learns to Walrus Memory — here is exactly how.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CrateInfoPage,
});

const SKILLS = [
  {
    name: "User input",
    how: "Everything you type or say in the chat — a mood, a setting, an artist, a memory — is written to Walrus as a taste note. Next session, Crate recalls it before picking a single song.",
  },
  {
    name: "Listening",
    how: "Crate counts how you listen. A song played to the end strengthens the road you're on. A replay marks a quiet favorite — but only after it happens in more than one session, so one good evening never becomes a loop. Skip the same artist twice and they fade out for the rest of the session.",
  },
  {
    name: "Steer",
    how: "Small chips like Svenskt, Engelskt, Nostalgi or Instrumental let you nudge the maze without stopping the music. Playing a song spontaneously works the same way — the maze continues from there. A chip you reach for in three or more sessions becomes a permanent taste memory.",
  },
  {
    name: "Feedbacker",
    how: "The sharpest signal Crate gets: a few free words about the song playing right now. \"Nostalgi, högstadiet, sommarens första dag\" ties a feeling to a track forever, and Walrus carries it into every future session.",
  },
  {
    name: "Deep cuts",
    how: "With Deep cuts on, Crate ignores everything you've heard in the last 60 days and digs into playlists a year old or more — the songs you loved and forgot.",
  },
];

function CrateInfoPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link
          to="/studio"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to the Studio
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight">
          How Crate uses Walrus
        </h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Crate is Songweaver's AI companion. It doesn't recommend from the whole
          of music — only from your own library, the playlists you built over the
          years. To remember what it learns about you, it writes to{" "}
          <span className="font-medium text-foreground">Walrus Memory</span>: a
          durable, verifiable store that survives every session. Nothing about
          your taste lives only in a chat window.
        </p>

        <section className="mt-10">
          <div className="flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">The maze</h2>
          </div>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Every session starts from one song — one you searched for, or the
            first pick from your prompt. From there, listening is a maze:
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Finish a song</span>{" "}
              → Crate keeps walking the same road — the same vibe, or the same
              playlist and months the song came from.
            </li>
            <li>
              <span className="font-medium text-foreground">Skip</span> → Crate
              turns onto the other road.
            </li>
            <li>
              <span className="font-medium text-foreground">Skip twice</span> →
              Crate tries a noticeably new angle.
            </li>
          </ul>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Both doors are always prepared in advance, so a skip is instant. The
            Maze box in the Studio shows the path so far, where you are, and the
            two songs waiting behind each door — with the reason for each pick.
          </p>

          <div className="mt-6 space-y-3">
            <div className="rounded-lg border bg-surface p-4">
              <h3 className="font-semibold">Vibe Road</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                The feeling road. Crate reads the mood, energy and sound of the
                song playing right now — together with the vibe you asked for in
                the chat — and aims for songs in your library that carry the
                same feeling, whatever year or playlist they come from. This is
                the road Crate picks when your prompt is about a mood, a
                setting or a sound rather than a time.
              </p>
            </div>
            <div className="rounded-lg border bg-surface p-4">
              <h3 className="font-semibold">Era Road</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                The time road. Crate walks through the same playlist and the
                same months the current song came from — the period of your life
                when you saved it. No AI guesses here: it follows your own
                library's history, so it surfaces songs you actually lived
                through together. Crate aims for this road when the anchor song
                or your prompt points at a period, a playlist or a memory.
              </p>
            </div>
            <div className="rounded-lg border bg-surface p-4">
              <h3 className="font-semibold">New Angle</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                The escape hatch. New Angle never appears as the "if you finish"
                song — it only shows up behind the skip door, and only after
                you've skipped more than once in a row. That's the clearest
                signal that the current direction is wrong, so Crate reads your
                Walrus memories and aims somewhere noticeably different: a
                fresh direction it believes you'll like, based on everything it
                has learned about how you listen.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Crate's skills</h2>
          </div>
          <div className="mt-4 space-y-3">
            {SKILLS.map((s) => (
              <div key={s.name} className="rounded-lg border bg-surface p-4">
                <h3 className="font-semibold">{s.name}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {s.how}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Why Walrus</h2>
          </div>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Each lesson — a typed mood, a skip pattern, a Feedbacker note — is
            written to Walrus as its own memory node. The Walrus panel in the
            Studio shows every note, when it was taken, why it was taken, and
            its storage status. Because the memory is durable and external, your
            taste profile is yours: inspectable, portable, and never trapped
            inside a conversation.
          </p>
        </section>

        <section className="mt-10">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">How memories are made</h2>
          </div>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            A memory is never "likes hip hop" — anyone can read that off your
            playlists. Crate only writes down what you can learn by watching how
            someone actually listens: the second their finger hits skip, the
            songs they always let finish, what they reach for at midnight. There
            are two kinds, and they are held to very different standards.
          </p>

          <div className="mt-4 space-y-3">
            <div className="rounded-lg border bg-surface p-4">
              <h3 className="font-semibold">Session observation</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Written during and at the end of a single session. Every seventh
                listening event — and again when you stop the radio — Crate
                steps back and reads the trace of that sitting: what was played
                to the end, what was skipped and after how many seconds, which
                road and side road you were on, which playlist and month each
                song came from, and the local time of every move. It may write
                at most two conclusions, and only about what happened right
                then. If the session was mostly untouched playback with no real
                choices in it, Crate writes nothing at all.
              </p>
            </div>

            <div className="rounded-lg border bg-surface p-4">
              <h3 className="font-semibold">Cross-session anchor</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                The durable layer. Crate reads up to 600 events spanning every
                session you've had, first as a summary — when each session
                started, how long it ran, how many songs were finished versus
                skipped, how engaged it was — and then as the full move-by-move
                trace. A pattern is only allowed to become an anchor if it holds
                across at least three separate sessions, or repeats as a clear
                time-of-day ritual. That's what produces memories like "in seven
                of eight sessions started after 23:00, vocal tracks get skipped
                in favour of instrumentals", or notices that an artist you once
                skipped has quietly become one you never skip.
              </p>
            </div>

            <div className="rounded-lg border bg-surface p-4">
              <h3 className="font-semibold">The unattended filter</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Music playing while you cook dinner looks identical to music you
                love — twelve songs finished, nothing touched. So any run of
                twelve or more finished songs with zero interaction is marked as
                possibly unattended, and Crate is forbidden from building a
                conclusion on those songs alone. They only count as weak support
                next to a real signal: a deliberate skip, a manual search, a
                road change, or the same song coming back in another session. A
                shorter run stays as-is — that's flow state, not absence.
              </p>
            </div>

            <div className="rounded-lg border bg-surface p-4">
              <h3 className="font-semibold">Into Walrus</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Each conclusion is stored as its own Walrus memory node with its
                own blob ID, labelled in the Studio panel as a{" "}
                <span className="font-medium text-foreground">
                  Session observation
                </span>{" "}
                or a{" "}
                <span className="font-medium text-foreground">
                  Cross-session anchor
                </span>
                . Before writing, Crate is shown everything it already remembers
                and told not to repeat or reword it, so the log grows instead of
                echoing. You can trigger a pass yourself at any time with{" "}
                <span className="font-medium text-foreground">
                  Let Crate reflect
                </span>{" "}
                in the Walrus panel.
              </p>
            </div>
          </div>
        </section>

        <div className="mt-12 border-t pt-6 pb-10">

          <Link
            to="/studio"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to the Studio
          </Link>
        </div>
      </div>
    </div>
  );
}
