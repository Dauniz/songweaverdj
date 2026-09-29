import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Shimmer } from "@/components/ai-elements/shimmer";
import { TrackCard, type CardTrack } from "./TrackCard";
import { useRadio } from "./radio-context";
import { CircleHelp, LoaderCircle, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { LENSES } from "@/lib/lenses";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import logo from "@/assets/crate-logo.jpg";
import { recordWav, type VoiceRecording } from "@/lib/record-wav";
import { LibrarySearch } from "./LibrarySearch";

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
  return prompt;
}

const TODAY_FALLBACKS = ["Ease me into today", "Play something that fits right now"];
// Keep the implementation ready for a future return, but hide voice input for every account.
const VOICE_INPUT_ENABLED = false;

async function transcribeVoice(file: File) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    const raw = await response.text();
    try {
      const parsed = JSON.parse(raw) as { error?: string; message?: string };
      throw new Error(parsed.error || parsed.message || "Voice transcription failed.");
    } catch (error) {
      if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
      throw new Error(raw || "Voice transcription failed.");
    }
  }
  if (!response.body) throw new Error("No transcript was returned.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let transcript = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const dataLine = event.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const parsed = JSON.parse(payload) as { type?: string; delta?: string; text?: string; error?: { message?: string } };
      if (parsed.type === "transcript.text.delta" && parsed.delta) transcript += parsed.delta;
      if (parsed.type === "transcript.text.done" && parsed.text) transcript = parsed.text;
      if (parsed.type === "error") throw new Error(parsed.error?.message || "Voice transcription failed.");
    }
    if (done) break;
  }
  const result = transcript.trim();
  if (!result) throw new Error("I didn't hear anything. Try again.");
  return result;
}

export function MoodChat({ onSearchSelection }: { onSearchSelection?: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recordingRef = useRef<VoiceRecording | null>(null);
  const stoppingRef = useRef(false);
  const { startRadio, lens, setLens, deepCuts, setDeepCuts } = useRadio();
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
  const personalizedPrompts = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const remembered = promptMemories.map(suggestionFromMemory);
    return [...remembered, ...TODAY_FALLBACKS]
      .filter((prompt, index, prompts) => prompts.findIndex((p) => norm(p) === norm(prompt)) === index)
      .slice(0, 2);
  }, [promptMemories]);

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
    messages: [],
    transport,
    onError: (e) => toast.error(e.message || "Something went wrong"),
    onFinish: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      textareaRef.current?.focus();
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // Auto-start the radio as soon as a fresh answer with picks lands.
  const autoStarted = useRef(new Set<string>());
  useEffect(() => {
    if (status !== "ready") return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || autoStarted.current.has(last.id)) return;
    autoStarted.current.add(last.id);
    for (const part of last.parts) {
      if (part.type === "tool-recommend_tracks" && part.state === "output-available") {
        const out = part.output as { vibe_title: string; tracks: CardTrack[] };
        if (out.tracks.length) {
          // Start on the song the user actually named, if it's among the picks.
          const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
          const asked = norm(lastUserText.current);
          const idx = out.tracks.findIndex((t) => {
            const n = norm(t.name.replace(/\s*[([-].*$/, ""));
            return n.length > 1 && asked.includes(n);
          });
          startRadio(out.tracks, lastUserText.current || out.vibe_title, Math.max(0, idx));
        }
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
    const activeLens = LENSES.find((l) => l.id === lens);
    if (activeLens) filters.push(`side road ${activeLens.name}: ${activeLens.info}`);
    sendMessage({ text: filters.length ? `${t}\n\n(Filters: ${filters.join("; ")})` : t });
    setText("");
  }

  const stopAndSendVoice = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording || stoppingRef.current) return;
    stoppingRef.current = true;
    recordingRef.current = null;
    setVoiceState("transcribing");
    try {
      const file = await recording.stop();
      const transcript = await transcribeVoice(file);
      send(transcript);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Voice transcription failed.");
    } finally {
      stoppingRef.current = false;
      setVoiceState("idle");
      textareaRef.current?.focus();
    }
  }, [busy, deepCuts, lens, sendMessage]);

  const toggleVoice = useCallback(async () => {
    if (voiceState === "recording") {
      await stopAndSendVoice();
      return;
    }
    if (voiceState !== "idle" || busy) return;
    try {
      setVoiceState("recording");
      const finishAfterSilence = () => {
        const finishWhenReady = () => {
          if (recordingRef.current) {
            void stopAndSendVoice();
          } else {
            window.setTimeout(finishWhenReady, 50);
          }
        };
        finishWhenReady();
      };
      recordingRef.current = await recordWav(finishAfterSilence);
    } catch (error) {
      setVoiceState("idle");
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      toast.error(denied ? "Allow microphone access to use voice prompts." : "The microphone could not start.");
    }
  }, [busy, stopAndSendVoice, voiceState]);

  useEffect(
    () => () => {
      void recordingRef.current?.cancel();
      recordingRef.current = null;
    },
    [],
  );

  const empty = messages.length === 0;

  const composer = (
    <div
      className={cn(
        "composer-reveal w-full bg-background/80 backdrop-blur",
        empty
          ? "mt-6 px-0 pb-4 sm:mt-10 sm:px-5 sm:pb-6 lg:px-7"
          : "border-t px-5 pb-8 pt-3 lg:px-7 lg:pb-10",
      )}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div data-onboarding="prompt">
        <div className={cn("mb-4", !empty && "pt-3")}>
          <LibrarySearch {...(onSearchSelection ? { onSelect: onSearchSelection } : {})} />
        </div>
        <PromptInput onSubmit={(msg) => send(msg.text)} className="bg-surface/90 shadow-sm">
          <PromptInputTextarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe the vibe, setting, or a song to start from…"
            className="min-h-24 px-4 py-3 text-base leading-6 placeholder:text-base sm:min-h-28 sm:text-lg sm:leading-7"
          />
          <PromptInputFooter className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              {VOICE_INPUT_ENABLED && (
                <>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant={voiceState === "recording" ? "default" : "ghost"}
                          size="icon-lg"
                          onClick={() => void toggleVoice()}
                          disabled={busy || voiceState === "transcribing"}
                          aria-label={voiceState === "recording" ? "Stop and send voice prompt" : "Speak your prompt"}
                          className={cn(
                            "rounded-full",
                            voiceState === "recording" && "animate-pulse",
                          )}
                        >
                          {voiceState === "transcribing" ? (
                            <LoaderCircle className="animate-spin" />
                          ) : voiceState === "recording" ? (
                            <Square className="fill-current" />
                          ) : (
                            <Mic />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {voiceState === "recording" ? "Stop and send" : "Speak your prompt"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {voiceState !== "idle" && (
                    <span className="text-sm text-muted-foreground" aria-live="polite">
                      {voiceState === "recording" ? "Listening… pause to send" : "Turning speech into your prompt…"}
                    </span>
                  )}
                </>
              )}
            </div>
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!busy && !text.trim()}
              size="icon-sm"
              className="h-11 w-11"
            />
          </PromptInputFooter>
        </PromptInput>
        </div>
        <TooltipProvider>
          <div data-onboarding="side-roads" className="mt-3 grid grid-cols-2 items-center gap-x-5 gap-y-1 px-1 text-sm sm:flex sm:flex-wrap sm:gap-x-6 sm:gap-y-2 sm:px-0 sm:text-xs">
            <span className="flex min-h-11 w-full origin-left items-center justify-between gap-2 sm:min-h-0 sm:w-fit sm:justify-start sm:gap-1.5 transition-transform duration-150 hover:scale-110">
              <label
                htmlFor="deep-cuts"
                className="cursor-pointer text-muted-foreground"
              >
                Deep cuts
              </label>
              <Checkbox
                id="deep-cuts"
                checked={deepCuts}
                onCheckedChange={(checked) => {
                  setDeepCuts(checked === true);
                }}
                aria-label="Enable Deep cuts"
                className="h-5 w-5 rounded-[4px] border-muted-foreground/60 data-[state=checked]:border-primary"
              />
            </span>
            {LENSES.map((l) => {
              const on = lens === l.id;
              return (
                <span key={l.id} className="flex min-h-11 w-full origin-left items-center justify-between gap-2 sm:min-h-0 sm:w-fit sm:justify-start sm:gap-1.5 transition-transform duration-150 hover:scale-110">
                  <label
                    htmlFor={`lens-${l.id}`}
                    className="cursor-pointer text-muted-foreground"
                  >
                    {l.name}
                  </label>
                  <Checkbox
                    id={`lens-${l.id}`}
                    checked={on}
                    onCheckedChange={(checked) => {
                      setLens(checked === true ? l.id : null);
                    }}
                    aria-label={`Enable ${l.name}`}
                    className="h-5 w-5 rounded-[4px] border-muted-foreground/60 data-[state=checked]:border-primary"
                  />
                </span>
              );
            })}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="About deep cuts and side roads"
                  className="justify-self-start rounded-full text-muted-foreground sm:justify-self-auto"
                >
                  <CircleHelp />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="center"
                className="max-w-[calc(100vw-2rem)] border border-border bg-background text-foreground shadow-lg sm:max-w-[300px]"
              >
                <p>
                  Side roads bend whichever road is active (Vibe, Era or New angle). Only one can be
                  on at a time — tap it again to turn it off.
                </p>
                {LENSES.map((l) => (
                  <p key={l.id} className="mt-3">
                    <span className="font-bold">{l.name}:</span> {l.info}
                  </p>
                ))}
                <p className="mt-3">
                  <span className="font-bold">Deep cuts:</span> Finds overlooked songs you
                  haven't heard in a while.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

      </div>
    </div>
  );

  if (empty) {
    return (
      <div className="chat-enter scrollbar-thin flex h-full flex-col items-center justify-start overflow-y-auto px-4 pb-8 pt-32 sm:px-6 sm:pb-16 sm:pt-36 xl:justify-center xl:pb-24 xl:pl-0 xl:pt-0 xl:max-2xl:pl-72 [@media(max-height:850px)]:pt-28 [@media(max-height:800px)]:justify-start [@media(max-height:800px)]:pb-6 [@media(max-height:800px)]:pt-24 sm:[@media(max-height:800px)]:pt-7">
        <div className="flex flex-col items-center text-center">
          <img
            src={logo}
            alt="Crate"
            width={80}
            height={80}
            className="h-14 w-14 rounded-2xl sm:h-20 sm:w-20 [@media(max-height:800px)]:h-12 [@media(max-height:800px)]:w-12 sm:[@media(max-height:800px)]:h-14 sm:[@media(max-height:800px)]:w-14"
          />
          <h2 className="mt-4 max-w-full text-3xl font-bold leading-tight sm:mt-6 sm:text-4xl [@media(max-height:800px)]:mt-3 [@media(max-height:800px)]:text-[1.75rem] sm:[@media(max-height:800px)]:text-3xl">
            What does today sound like?
          </h2>
          <p className="mt-3 max-w-lg text-base leading-6 text-muted-foreground sm:text-lg sm:leading-7 [@media(max-height:800px)]:text-base [@media(max-height:800px)]:leading-6">
            Describe your mood, where you are, what you're doing. I'll dig up tracks you already
            love from your past playlists.
          </p>
          <p className="mt-2 max-w-lg text-sm leading-5 text-muted-foreground/70 sm:text-base sm:leading-6">
            Either search for a song or send a prompt to Crate to initialize a Songweaver session.
          </p>
        </div>
        {composer}
      </div>
    );
  }

  return (
    <div className="chat-enter flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="chat-transcript mx-auto w-full max-w-4xl gap-4 px-5 pb-8 pt-48 text-[1.0625rem] leading-7 lg:px-7">
          {messages.map((m) => (
            <Message
              key={m.id}
              from={m.role}
              className={cn("chat-message-reveal", m.role === "assistant" && "!max-w-full")}
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
                              {out.tracks.slice(0, 6).map((t, j) => (
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
                    return null;
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}
          {busy && (messages.at(-1)?.role !== "assistant" || status === "submitted" || !messages.at(-1)?.parts.some((p) => p.type === "text" && p.text)) && (
            <Message from="assistant" className="!max-w-full">
              <MessageContent className="bg-transparent">
                <Shimmer>Crate is digging through your library…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {composer}
    </div>
  );
}
