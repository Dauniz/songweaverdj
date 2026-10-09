import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { answerWelcome, getWelcomeSuggestion, type WelcomeSuggestion } from "@/lib/welcome.functions";
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
import { cn } from "@/lib/utils";
import { LoaderCircle, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { LENSES } from "@/lib/lenses";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import logo from "@/assets/crate-logo.jpg";
import { recordWav, type VoiceRecording } from "@/lib/record-wav";
import { LibrarySearch } from "./LibrarySearch";
import { StudioSuggestions } from "./StudioSuggestions";
import { geometricEnter, reducedFade, staggerChildren } from "@/lib/motion";

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
  const reduced = useReducedMotion();
  const [text, setText] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recordingRef = useRef<VoiceRecording | null>(null);
  const stoppingRef = useRef(false);
  const { startRadio, steerSession, sessionLive, lens, deepCuts, promptPlaylist } = useRadio();
  const [playlistTitle, setPlaylistTitle] = useState("");
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

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    id: "crate-main",
    messages: [],
    transport,
    onError: (e) => toast.error(e.message || "Something went wrong"),
    onFinish: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      textareaRef.current?.focus({ preventScroll: true });
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
        const out = part.output as {
          vibe_title: string;
          start_road?: "vibe" | "era";
          steer_only?: boolean;
          steer_note?: string;
          tracks: CardTrack[];
        };
        if (out.steer_only) {
          // Mid-session chat steering: re-scout the upcoming doors, never touch the playing song.
          void steerSession(out.steer_note ?? "", out.tracks ?? []);
          setMessages([]);
          break;
        }
        if (out.tracks.length) {
          // Start on the song the user actually named, if it's among the picks.
          const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
          const asked = norm(lastUserText.current);
          const idx = out.tracks.findIndex((t) => {
            const n = norm(t.name.replace(/\s*[([-].*$/, ""));
            return n.length > 1 && asked.includes(n);
          });
          startRadio(out.tracks, lastUserText.current || out.vibe_title, Math.max(0, idx), out.start_road);
          setPlaylistTitle(out.vibe_title);
          setMessages([]);
        }
        break;
      }
    }
  }, [status, messages, startRadio, steerSession, setMessages]);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  // Proactive welcome guess — once per visit per weekday+hour window, only before a session.
  const fetchWelcome = useServerFn(getWelcomeSuggestion);
  const logWelcome = useServerFn(answerWelcome);
  const [welcome, setWelcome] = useState<WelcomeSuggestion>(null);
  const welcomeAsked = useRef(false);
  useEffect(() => {
    if (welcomeAsked.current || sessionLive) return;
    welcomeAsked.current = true;
    const now = new Date();
    const key = `songweaver-welcome-${now.getDay()}-${now.getHours()}`;
    const cached = sessionStorage.getItem(key);
    if (cached === "dismissed") return;
    if (cached) {
      try { setWelcome(JSON.parse(cached)); } catch { /* ignore */ }
      return;
    }
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const meta = (data.user?.user_metadata ?? {}) as Record<string, string>;
      const firstName = (meta["full_name"] || meta["name"] || "").split(" ")[0] ?? "";
      try {
        const s = await fetchWelcome({ data: { tzOffsetMin: now.getTimezoneOffset(), firstName: firstName.slice(0, 40) } });
        sessionStorage.setItem(key, s ? JSON.stringify(s) : "dismissed");
        setWelcome(s);
      } catch { /* silent: no card */ }
    })();
  }, [sessionLive, fetchWelcome]);
  function answerWelcomeGuess(accepted: boolean) {
    if (!welcome) return;
    const now = new Date();
    sessionStorage.setItem(`songweaver-welcome-${now.getDay()}-${now.getHours()}`, "dismissed");
    void logWelcome({ data: { prompt: welcome.prompt, accepted, tzOffsetMin: now.getTimezoneOffset() } }).catch(() => {});
    if (accepted) send(welcome.prompt);
    setWelcome(null);
  }

  function send(raw: string) {
    const t = raw.trim();
    if (!t || busy) return;
    lastUserText.current = t;
    const filters: string[] = [];
    if (deepCuts) filters.push("prefer deep cuts I haven't heard in a while");
    const activeLens = LENSES.find((l) => l.id === lens);
    if (activeLens) filters.push(`alternative road ${activeLens.name}: ${activeLens.info}`);
    // A live session turns every chat message into steering — Crate re-plans the doors ahead
    // instead of starting over. The marker is stripped from the visible transcript.
    const live = sessionLive ? "\n\n(Session is live — steer instead of restarting)" : "";
    sendMessage({
      text: `${t}${filters.length ? `\n\n(Filters: ${filters.join("; ")})` : ""}${live}`,
    });
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
        "composer-reveal w-full",
        empty
          ? "mt-3 shrink-0 px-0 pb-2 sm:mt-4 sm:px-5 sm:pb-4 lg:px-7"
          : "border-t px-5 pb-8 pt-3 lg:px-7 lg:pb-10",
      )}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div data-onboarding="prompt">
        {empty && welcome && !sessionLive && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.35 }}
            className="mb-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-surface/90 p-3 shadow-sm sm:flex"
          >
            <img src={logo} alt="" className="h-9 w-9 shrink-0 rounded-lg" />
            <p className="min-w-0 flex-1 text-xs leading-5 sm:text-sm">{welcome.greeting}</p>
            <div className="col-start-2 flex shrink-0 gap-2">
              <Button size="sm" className="rounded-full" onClick={() => answerWelcomeGuess(true)}>Yes, play it</Button>
              <Button size="sm" variant="secondary" className="rounded-full" onClick={() => answerWelcomeGuess(false)}>Not now</Button>
            </div>
          </motion.div>
        )}
        <div className={cn(empty ? "mb-3" : "mb-4 pt-3")}>
          <LibrarySearch {...(onSearchSelection ? { onSelect: onSearchSelection } : {})} />
        </div>
        <PromptInput onSubmit={(msg) => send(msg.text)} className="bg-surface/90 shadow-sm">
          <PromptInputTextarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              sessionLive
                ? 'Not feeling it? Tell Crate to steer the session in any direction. For example "More rap", "Less energy", "More nostalgia"'
                : "Describe the vibe, setting, or a song to start from…"
            }
            className={cn("min-h-24 px-4 py-3 text-base leading-6 placeholder:text-base sm:min-h-28 sm:text-lg sm:leading-7", empty && "min-h-16 sm:min-h-20")}
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
        {empty && !sessionLive && (
          <div className="mt-6 sm:mt-8">
            <StudioSuggestions {...(onSearchSelection ? { onPlay: onSearchSelection } : {})} />
          </div>
        )}
      </div>
    </div>
  );

  if (empty) {
    return (
      <div
        className={cn(
          "chat-enter scrollbar-thin flex h-full min-h-0 flex-col items-center overflow-y-auto px-4 pb-2 pt-3 sm:px-6 sm:pt-4 xl:pt-6 [&>*]:shrink-0",
          sessionLive && !(promptPlaylist && promptPlaylist.length > 0) ? "justify-center" : "justify-start",
        )}
      >
        {sessionLive && promptPlaylist && promptPlaylist.length > 0 && (
          <div className="song-results-reveal mb-8 w-full max-w-3xl">
            <div className="mb-1.5 font-display text-lg font-bold text-primary">
              {playlistTitle || "Crate's playlist"}
            </div>
            <motion.div variants={staggerChildren} initial="hidden" animate="visible" className="grid gap-1.5 sm:grid-cols-2">
              {promptPlaylist.slice(0, 6).map((t, j) => (
                <TrackCard key={t.id} track={t} index={j} />
              ))}
            </motion.div>
          </div>
        )}
        <div className="flex w-full flex-col items-center text-center">
          <img
            src={logo}
            alt="Crate"
            width={80}
            height={80}
            className="h-10 w-10 rounded-lg sm:h-12 sm:w-12 [@media(max-height:750px)]:hidden"
          />
          <h2 className="mt-3 max-w-full text-2xl font-bold leading-tight sm:text-3xl">
            {sessionLive ? "Want to steer your session?" : "What does today sound like?"}
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-5 text-muted-foreground sm:text-base sm:leading-6">
            {sessionLive
              ? "Are you missing something? Tweak the session with your own input."
              : "Describe your mood, where you are, what you're doing. I'll tune in a track-list meant for the moment."}
          </p>
          <p className="mt-2 max-w-lg text-xs leading-5 text-muted-foreground/70 sm:text-sm">
            {sessionLive
              ? "Steering the session will make Crate skip to the desired track."
              : "Either search for a song or send a prompt to Crate to initialize a Songweaver session."}
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
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: reduced ? 0 : 8, clipPath: reduced ? "none" : "inset(0 0 18% 0)" }}
              animate={{ opacity: 1, y: 0, clipPath: "inset(0)" }}
              transition={{ duration: reduced ? 0.12 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
            <Message
              from={m.role}
              className={cn(m.role === "assistant" && "!max-w-full")}
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
                        ? part.text.replace(/\n\n\((?:Filters|Session is live)[^)]*\)(?=\n\n\(|$)/g, "")
                        : part.text;
                    return <MessageResponse key={i}>{shown}</MessageResponse>;
                  }
                  if (part.type === "tool-recommend_tracks") {
                    const out =
                      part.state === "output-available"
                        ? (part.output as { vibe_title: string; start_road?: "vibe" | "era"; tracks: CardTrack[] })
                        : null;
                    return (
                      <div key={i} className="song-results-reveal my-1 w-full">
                        {out ? (
                          <>
                            <div className="mb-1.5 font-display text-lg font-bold text-primary">
                              {out.vibe_title}
                            </div>
                            <motion.div variants={staggerChildren} initial="hidden" animate="visible" className="grid gap-1.5 sm:grid-cols-2">
                              {out.tracks.slice(0, 6).map((t, j) => (
                                <TrackCard
                                  key={t.id}
                                  track={t}
                                  index={j}
                                />
                              ))}
                            </motion.div>
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
            </motion.div>
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
