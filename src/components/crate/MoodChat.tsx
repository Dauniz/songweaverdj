import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { TrackCard, type CardTrack } from "./TrackCard";
import { useRadio } from "./radio-context";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import logo from "@/assets/crate-logo.jpg";

export const PRESETS = [
  {
    label: "Late-night coding",
    prompt: "Late night coding session, need focus but with some warmth — nothing too busy.",
  },
  {
    label: "Nostalgic drive",
    prompt: "Nostalgic drive at golden hour, windows down, feeling sentimental.",
  },
  { label: "Rainy focus", prompt: "Rainy afternoon, deep focus, moody and soft." },
  {
    label: "Sunday reset",
    prompt: "Slow Sunday morning reset, coffee, cleaning the apartment, gentle and hopeful.",
  },
  { label: "Pre-party hype", prompt: "Getting ready to go out, want energy and swagger." },
  {
    label: "Heartache hours",
    prompt: "Bit heartbroken tonight, want songs that sit with the feeling.",
  },
];

const ERAS = ["Any era", "2+ years ago", "Last year", "This year"] as const;

export function MoodChat({ initialMessages }: { initialMessages: UIMessage[] }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [era, setEra] = useState<(typeof ERAS)[number]>("Any era");
  const [deepCuts, setDeepCuts] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { startRadio } = useRadio();
  const lastUserText = useRef("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: async (): Promise<Record<string, string>> => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: "crate-main",
    messages: initialMessages,
    transport,
    onError: (e) => toast.error(e.message || "Something went wrong"),
    onFinish: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      textareaRef.current?.focus();
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // Auto-start the radio as soon as a fresh answer with picks lands.
  const autoStarted = useRef(new Set(initialMessages.map((m) => m.id)));
  useEffect(() => {
    if (status !== "ready") return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || autoStarted.current.has(last.id)) return;
    autoStarted.current.add(last.id);
    for (const part of last.parts) {
      if (part.type === "tool-recommend_tracks" && part.state === "output-available") {
        const out = part.output as { vibe_title: string; tracks: CardTrack[] };
        if (out.tracks.length) startRadio(out.tracks, lastUserText.current || out.vibe_title);
        break;
      }
    }
  }, [status, messages, startRadio]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function send(raw: string) {
    const t = raw.trim();
    if (!t || busy) return;
    lastUserText.current = t;
    const filters: string[] = [];
    if (era !== "Any era") filters.push(`era: ${era}`);
    if (deepCuts) filters.push("prefer deep cuts I haven't heard in a while");
    sendMessage({ text: filters.length ? `${t}\n\n(Filters: ${filters.join("; ")})` : t });
    setText("");
  }

  return (
    <div className="flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <img
                src={logo}
                alt="Crate"
                width={80}
                height={80}
                className="h-20 w-20 rounded-2xl"
              />
              <h2 className="mt-6 text-3xl font-bold">What does today sound like?</h2>
              <p className="mt-2 max-w-md text-muted-foreground">
                Describe your mood, where you are, what you're doing. I'll dig up tracks you already
                love from your past playlists.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <Message key={m.id} from={m.role}>
              <MessageContent
                className={cn(
                  m.role === "user"
                    ? "group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground"
                    : "w-full bg-transparent",
                )}
              >
                {m.parts.map((part, i) => {
                  if (part.type === "text") {
                    const shown =
                      m.role === "user"
                        ? part.text.replace(/\n\n\(Filters:[^)]*\)$/, "")
                        : part.text;
                    return <MessageResponse key={i}>{shown}</MessageResponse>;
                  }
                  if (part.type === "tool-recommend_tracks") {
                    const out =
                      part.state === "output-available"
                        ? (part.output as { vibe_title: string; tracks: CardTrack[] })
                        : null;
                    return (
                      <div key={i} className="my-2 w-full">
                        {out ? (
                          <>
                            <div className="mb-2 font-display text-lg font-bold text-primary">
                              {out.vibe_title}
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {out.tracks.map((t, j) => (
                                <TrackCard
                                  key={t.id}
                                  track={t}
                                  index={j}
                                  onPlay={() =>
                                    startRadio(out.tracks, lastUserText.current || out.vibe_title, j)
                                  }
                                />
                              ))}
                            </div>
                            {out.tracks.length > 0 && (
                              <button
                                onClick={() => startRadio(out.tracks, lastUserText.current || out.vibe_title)}
                                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:scale-[1.02]"
                              >
                                <Radio className="h-3.5 w-3.5" /> Start vibe radio from these picks
                              </button>
                            )}
                          </>
                        ) : part.state === "output-error" ? (
                          <p className="text-sm text-destructive">Couldn't load picks.</p>
                        ) : (
                          <Shimmer>Digging through your crates…</Shimmer>
                        )}
                      </div>
                    );
                  }
                  if (part.type === "tool-save_memory") {
                    return (
                      <Tool key={i} defaultOpen={false} className="my-1">
                        <ToolHeader
                          type={part.type}
                          state={part.state}
                          title="Saved to Walrus Memory"
                        />
                        <ToolContent>
                          <ToolInput input={part.input} />
                          {part.state === "output-available" && (
                            <ToolOutput output={part.output} errorText={undefined} />
                          )}
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}
          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent className="bg-transparent">
                <Shimmer>Listening to your vibe…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t bg-background/80 p-4 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          <div className="scrollbar-thin mb-3 flex gap-2 overflow-x-auto pb-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => send(p.prompt)}
                disabled={busy}
                className="shrink-0 rounded-full border bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            {ERAS.map((e) => (
              <button
                key={e}
                onClick={() => setEra(e)}
                className={cn(
                  "rounded-full px-2.5 py-1 transition",
                  era === e
                    ? "bg-magenta text-magenta-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {e}
              </button>
            ))}
            <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground">
              <input
                type="checkbox"
                checked={deepCuts}
                onChange={(e) => setDeepCuts(e.target.checked)}
                className="accent-primary"
              />
              Deep cuts
            </label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About deep cuts"
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] leading-none text-muted-foreground transition hover:border-primary hover:text-primary"
                  >
                    ?
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px]">
                  Skips tracks you have played a lot recently and digs up
                  overlooked ones instead — album tracks, older saves and songs
                  you have not heard in years.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <PromptInput onSubmit={(msg) => send(msg.text)}>
            <PromptInputTextarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. 2am, city lights, finishing a project…"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} onStop={stop} disabled={!busy && !text.trim()} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
