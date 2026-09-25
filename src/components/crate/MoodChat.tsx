import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import logo from "@/assets/crate-logo.jpg";

type PromptMemory = { id: string; kind: string; content: string };

function suggestionFromMemory(memory: PromptMemory) {
  const content = memory.content.replace(/[.!]+$/, "").trim();
  const quoted = content.match(/[“"]([^”"]+)[”"]/u)?.[1];
  const prompt =
    memory.kind === "favorite" && quoted
      ? `Build a vibe around ${quoted}`
      : memory.kind === "session"
        ? `Continue this feeling: ${content}`
        : memory.kind === "mood_trigger"
          ? `Play for this mood: ${content}`
          : `Lean into this: ${content}`;
  return prompt.length > 74 ? `${prompt.slice(0, 71).trim()}…` : prompt;
}

export function MoodChat({ initialMessages }: { initialMessages: UIMessage[] }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [deepCuts, setDeepCuts] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { startRadio } = useRadio();
  const lastUserText = useRef("");
  const { data: promptMemories = [] } = useQuery({
    queryKey: ["prompt-memories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memory_nodes")
        .select("id, kind, content")
        .in("kind", ["taste", "genre", "mood_trigger", "session", "favorite"])
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data as PromptMemory[];
    },
  });
  const personalizedPrompts = useMemo(
    () => [...new Set(promptMemories.map(suggestionFromMemory))].slice(0, 3),
    [promptMemories],
  );

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
    if (deepCuts) filters.push("prefer deep cuts I haven't heard in a while");
    sendMessage({ text: filters.length ? `${t}\n\n(Filters: ${filters.join("; ")})` : t });
    setText("");
  }

  return (
    <div className="chat-enter flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="chat-transcript mx-auto w-full max-w-4xl gap-4 px-5 pb-8 pt-2 lg:px-7">
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
            <Message
              key={m.id}
              from={m.role}
              className={cn("chat-message-reveal", m.role === "assistant" && "max-w-full")}
            >
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
                      <div key={i} className="song-results-reveal my-1 w-full">
                        {out ? (
                          <>
                            <div className="mb-1.5 font-display text-lg font-bold text-primary">
                              {out.vibe_title}
                            </div>
                            <div className="grid gap-1.5 sm:grid-cols-2">
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
                              <Button
                                onClick={() => startRadio(out.tracks, lastUserText.current || out.vibe_title)}
                                size="sm"
                                className="mt-2 rounded-full px-4 transition-transform hover:scale-[1.02]"
                              >
                                <Radio className="h-3.5 w-3.5" /> Start vibe radio from these picks
                              </Button>
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
                      <Tool key={i} defaultOpen={false} className="memory-reveal my-0.5">
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
            <Message from="assistant" className="max-w-full">
              <MessageContent className="bg-transparent">
                <Shimmer>Listening to your vibe…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="composer-reveal border-t bg-background/80 px-5 pb-8 pt-3 backdrop-blur lg:px-7 lg:pb-10">
        <div className="mx-auto w-full max-w-4xl">
          {personalizedPrompts.length > 0 && (
            <div className="scrollbar-thin mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {personalizedPrompts.map((prompt) => (
                <Button
                  key={prompt}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => send(prompt)}
                  disabled={busy}
                  className="shrink-0 rounded-full bg-surface px-3 text-muted-foreground hover:border-primary hover:text-primary"
                >
                  {prompt}
                </Button>
              ))}
            </div>
          )}
          <PromptInput onSubmit={(msg) => send(msg.text)} className="bg-surface/90">
            <PromptInputTextarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe the vibe, setting, or a song to start from…"
              className="min-h-24 text-base"
            />
            <PromptInputFooter className="grid grid-cols-[minmax(0,1fr)_auto] items-center">
              <div className="flex min-w-0 items-center gap-1.5">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
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
                      <Button
                    type="button"
                    aria-label="About deep cuts"
                    variant="outline"
                    size="icon-xs"
                    className="h-5 w-5 shrink-0 rounded-full border-muted-foreground/40 p-0 text-[10px] text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    ?
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px]">
                      Skips tracks you have played a lot recently and digs up overlooked ones instead
                      — album tracks, older saves and songs you have not heard in years.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <PromptInputSubmit
                status={status}
                onStop={stop}
                disabled={!busy && !text.trim()}
                size="icon-sm"
                className="h-10 w-10"
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
