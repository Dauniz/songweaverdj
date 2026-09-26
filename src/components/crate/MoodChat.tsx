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
import { CircleHelp, LoaderCircle, Mic, Radio, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import logo from "@/assets/crate-logo.jpg";
import { recordWav, type VoiceRecording } from "@/lib/record-wav";

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

export function MoodChat() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [deepCuts, setDeepCuts] = useState(true);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recordingRef = useRef<VoiceRecording | null>(null);
  const stoppingRef = useRef(false);
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
  const personalizedPrompts = useMemo(() => {
    const remembered = [...new Set(promptMemories.map(suggestionFromMemory))];
    return [...remembered, ...TODAY_FALLBACKS].filter(
      (prompt, index, prompts) => prompts.indexOf(prompt) === index,
    ).slice(0, 2);
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
  }, [busy, deepCuts, sendMessage]);

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
          ? "mt-10 px-5 pb-6 lg:px-7"
          : "border-t px-5 pb-8 pt-3 lg:px-7 lg:pb-10",
      )}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-2.5 flex items-center gap-2">
          <div className="scrollbar-thin flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {personalizedPrompts.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => send(prompt)}
                disabled={busy}
                className="h-8 shrink-0 rounded-full bg-surface px-3.5 text-sm text-muted-foreground hover:border-primary hover:text-primary"
              >
                {prompt}
              </Button>
            ))}
          </div>
        </div>
        <PromptInput onSubmit={(msg) => send(msg.text)} className="bg-surface/90 shadow-sm">
          <PromptInputTextarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe the vibe, setting, or a song to start from…"
            className="min-h-28 px-4 py-3 text-lg leading-7 placeholder:text-base"
          />
          <PromptInputFooter className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
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
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <label htmlFor="deep-cuts" className="cursor-pointer text-muted-foreground">
            Deep cuts
          </label>
          <Checkbox
            id="deep-cuts"
            checked={deepCuts}
            onCheckedChange={(checked) => setDeepCuts(checked === true)}
            aria-label="Enable Deep cuts"
            className="h-[15px] w-[15px] rounded-[3px] border-muted-foreground/60 data-[state=checked]:border-primary"
          />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="About Deep cuts"
                  className="rounded-full text-muted-foreground"
                >
                  <CircleHelp />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[240px]">
                Finds overlooked songs you haven't heard in a while.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );

  if (empty) {
    return (
      <div className="chat-enter flex h-full flex-col items-center justify-center pb-24">
        <div className="flex flex-col items-center text-center">
          <img
            src={logo}
            alt="Crate"
            width={80}
            height={80}
            className="h-20 w-20 rounded-2xl"
          />
          <h2 className="mt-6 text-4xl font-bold">What does today sound like?</h2>
          <p className="mt-3 max-w-lg text-lg leading-7 text-muted-foreground">
            Describe your mood, where you are, what you're doing. I'll dig up tracks you already
            love from your past playlists.
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
            <Message from="assistant" className="!max-w-full">
              <MessageContent className="bg-transparent">
                <Shimmer>Listening to your vibe…</Shimmer>
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
