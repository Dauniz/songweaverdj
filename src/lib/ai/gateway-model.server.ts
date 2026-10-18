import { generateChatCompletion, streamChatCompletion, type GeminiChatFields, type GeminiChatMessage, type ChatCompletion, type CallOptions } from "@lovable.dev/ai-gateway";
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4Content, LanguageModelV4FinishReason, LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import { z } from "zod";

export const TEXT_MODEL = "google/gemini-3-flash-preview";
const detailBase = { id: z.string().nullable().optional(), index: z.number().optional(), format: z.enum(["unknown", "openai-responses-v1", "azure-openai-responses-v1", "bedrock-openai-responses-v1", "bedrock-xai-responses-v1", "xai-responses-v1", "meta-responses-v1", "anthropic-claude-v1", "google-gemini-v1"]).nullable().optional() };
const detailsSchema = z.array(z.discriminatedUnion("type", [
  z.object({ ...detailBase, type: z.literal("reasoning.encrypted"), data: z.string() }),
  z.object({ ...detailBase, type: z.literal("reasoning.text"), text: z.string().nullable().optional(), signature: z.string().nullable().optional() }),
  z.object({ ...detailBase, type: z.literal("reasoning.summary"), summary: z.string() }),
  z.object({ ...detailBase, type: z.literal("reasoning.server_tool_call"), arguments: z.string(), result: z.string(), tool_name: z.string(), tool_call_id: z.string().nullable().optional() }),
]));
function reasoningDetails(value: unknown) {
  const parsed = detailsSchema.safeParse(value);
  if (!parsed.success) return [];
  // Object spreads avoid assigning explicitly undefined optional contract fields.
  return parsed.data.map((d) => JSON.parse(JSON.stringify(d))).map((d: unknown) => detailsSchema.element.parse(d));
}

export function gatewayPayload(options: LanguageModelV4CallOptions): GeminiChatFields & { model: typeof TEXT_MODEL } {
  const messages: GeminiChatMessage[] = [];
  for (const message of options.prompt) {
    if (message.role === "system") { messages.push({ role: "system", content: message.content }); continue; }
    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type !== "tool-result") throw new Error("Unsupported tool approval response");
        const output = part.output;
        const content = "value" in output ? (typeof output.value === "string" ? output.value : JSON.stringify(output.value)) : JSON.stringify(output);
        messages.push({ role: "tool", tool_call_id: part.toolCallId, content });
      }
      continue;
    }
    const text = message.content.map((p) => p.type === "text" ? p.text : "").join("");
    if (message.role === "user") {
      if (message.content.some((p) => p.type !== "text")) throw new Error("Crate chat expects text; voice is transcribed separately");
      messages.push({ role: "user", content: text });
    } else {
      const calls = message.content.filter((p) => p.type === "tool-call").map((p) => ({ type: "function" as const, id: p.toolCallId, function: { name: p.toolName, arguments: JSON.stringify(p.input) } }));
      const reasoning = message.content.filter((p) => p.type === "reasoning").map((p) => p.text).join("");
      const details = message.content.flatMap((p) => reasoningDetails(p.providerOptions?.["lovable"]?.["reasoningDetails"]));
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}), ...(reasoning ? { reasoning } : {}), ...(details.length ? { reasoning_details: details } : {}) });
    }
  }
  const tools = options.tools?.map((t) => {
    if (t.type !== "function") throw new Error("Unsupported provider tool");
    return { type: "function" as const, function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: { ...t.inputSchema } } };
  });
  const choice = options.toolChoice;
  const format = options.responseFormat;
  return {
    model: TEXT_MODEL, messages, ...(tools ? { tools } : {}),
    ...(choice ? { tool_choice: choice.type === "tool" ? { type: "function", function: { name: choice.toolName } } : choice.type } : {}),
    ...(format?.type === "json" ? { response_format: format.schema ? { type: "json_schema", json_schema: { name: format.name ?? "response", schema: { ...format.schema }, strict: true } } : { type: "json_object" } } : {}),
    ...(options.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.topK !== undefined ? { top_k: options.topK } : {}),
    ...(options.stopSequences ? { stop: options.stopSequences } : {}),
    ...(options.presencePenalty !== undefined ? { presence_penalty: options.presencePenalty } : {}),
    ...(options.frequencyPenalty !== undefined ? { frequency_penalty: options.frequencyPenalty } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    stream_options: { include_usage: true },
  };
}

function finish(raw?: string | null): LanguageModelV4FinishReason {
  const unified = raw === "tool_calls" || raw === "function_call" ? "tool-calls" : raw === "content_filter" ? "content-filter" : raw === "stop" || raw === "length" || raw === "error" ? raw : "other";
  return { unified, raw: raw ?? undefined };
}
function usage(value?: ChatCompletion["usage"] | null): LanguageModelV4Usage {
  return { inputTokens: { total: value?.prompt_tokens, noCache: undefined, cacheRead: value?.prompt_tokens_details?.cached_tokens, cacheWrite: undefined }, outputTokens: { total: value?.completion_tokens, text: undefined, reasoning: value?.completion_tokens_details?.reasoning_tokens } };
}

/** Gateway SDK transport, AI SDK orchestration: retain existing UI streams and tool execution. */
export function createGatewayModel(initialRunId?: string) {
  let runId = initialRunId;
  let publish: (id: string | undefined) => void = () => {};
  const ready = new Promise<string | undefined>((resolve) => { publish = resolve; });
  const optionsFor = (options: LanguageModelV4CallOptions): CallOptions => ({ ...(options.abortSignal ? { signal: options.abortSignal } : {}), ...(runId ? { runId } : {}) });
  const model: LanguageModelV4 = {
    specificationVersion: "v4", provider: "lovable.gateway", modelId: TEXT_MODEL, supportedUrls: {},
    async doGenerate(options) {
      try {
        const response = await generateChatCompletion(gatewayPayload(options), optionsFor(options));
        const choice = response.choices[0];
        if (!choice) throw new Error("Gateway returned no completion");
        const content: LanguageModelV4Content[] = [];
        if (choice.message.reasoning) content.push({ type: "reasoning", text: choice.message.reasoning });
        const details = choice.message.reasoning_details;
        if (choice?.message.refusal) content.push({ type: "text", text: choice.message.refusal });
        else if (choice?.message.content) content.push({ type: "text", text: choice.message.content });
        for (const call of choice?.message.tool_calls ?? []) {
          if (!choice.message.refusal && call.type === "function") content.push({ type: "tool-call", toolCallId: call.id, toolName: call.function.name, input: call.function.arguments, ...(details?.length ? { providerMetadata: { lovable: { reasoningDetails: details } } } : {}) });
        }
        return { content, finishReason: finish(choice?.finish_reason), usage: usage(response.usage), warnings: [], response: { id: response.id, modelId: response.model, timestamp: new Date(response.created * 1000) } };
      } finally { publish(runId); }
    },
    async doStream(options) {
      const abort = new AbortController();
      const onAbort = () => abort.abort(options.abortSignal?.reason);
      if (options.abortSignal?.aborted) onAbort();
      options.abortSignal?.addEventListener("abort", onAbort, { once: true });
      let source;
      try { source = await streamChatCompletion(gatewayPayload(options), { ...optionsFor(options), signal: abort.signal }); }
      catch (error) { options.abortSignal?.removeEventListener("abort", onAbort); publish(runId); throw error; }
      runId = source.runId ?? runId;
      publish(runId);
      const iterator = source[Symbol.asyncIterator]();
      let cancelled = false;
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          let textOpen = false, reasoningOpen = false;
          const calls = new Map<number, { id: string; name: string; input: string; started: boolean }>();
          let lastUsage: ChatCompletion["usage"];
          let reason: string | null | undefined;
          let refused = false;
          const details: NonNullable<NonNullable<ChatCompletion["choices"][number]["message"]["reasoning_details"]>> = [];
          controller.enqueue({ type: "stream-start", warnings: [] });
          try {
            while (!cancelled) {
              const item = await iterator.next();
              if (item.done) break;
              const event = item.value;
              controller.enqueue({ type: "response-metadata", id: event.id, modelId: event.model, timestamp: new Date(event.created * 1000) });
              if (event.usage) lastUsage = event.usage;
              const choice = event.choices[0];
              if (!choice) continue;
              if (choice.finish_reason) reason = choice.finish_reason;
              const delta = choice.delta;
              if (delta.reasoning_details) details.push(...delta.reasoning_details);
              if (delta.refusal) refused = true;
              if (delta.content || delta.refusal) {
                if (!textOpen) { controller.enqueue({ type: "text-start", id: "text" }); textOpen = true; }
                controller.enqueue({ type: "text-delta", id: "text", delta: delta.refusal || delta.content || "" });
              }
              if (delta.reasoning) {
                if (!reasoningOpen) { controller.enqueue({ type: "reasoning-start", id: "reasoning" }); reasoningOpen = true; }
                controller.enqueue({ type: "reasoning-delta", id: "reasoning", delta: delta.reasoning });
              }
              for (const fragment of delta.tool_calls ?? []) {
                const call = calls.get(fragment.index) ?? { id: "", name: "", input: "", started: false };
                call.id = fragment.id ?? call.id;
                call.name += fragment.function?.name ?? "";
                call.input += fragment.function?.arguments ?? "";
                if (!call.started && call.id && call.name) {
                  controller.enqueue({ type: "tool-input-start", id: call.id, toolName: call.name });
                  call.started = true;
                  if (call.input) controller.enqueue({ type: "tool-input-delta", id: call.id, delta: call.input });
                } else if (call.started && fragment.function?.arguments) controller.enqueue({ type: "tool-input-delta", id: call.id, delta: fragment.function.arguments });
                calls.set(fragment.index, call);
              }
            }
            if (cancelled) return;
            if (options.abortSignal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
            if (textOpen) controller.enqueue({ type: "text-end", id: "text" });
            if (reasoningOpen) controller.enqueue({ type: "reasoning-end", id: "reasoning" });
            for (const call of refused ? [] : calls.values()) {
              if (!call.id || !call.name) throw new Error("Incomplete Gateway tool call");
              controller.enqueue({ type: "tool-input-end", id: call.id });
              controller.enqueue({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: call.input, ...(details.length ? { providerMetadata: { lovable: { reasoningDetails: details } } } : {}) });
            }
            controller.enqueue({ type: "finish", finishReason: finish(reason), usage: usage(lastUsage) });
            controller.close();
          } catch (error) {
            if (!cancelled) { controller.enqueue({ type: "error", error }); controller.close(); }
          } finally { options.abortSignal?.removeEventListener("abort", onAbort); await iterator.return?.(); }
        },
        async cancel() { cancelled = true; abort.abort(); await iterator.return?.(); },
      });
      return { stream, response: { headers: runId ? { "x-lovable-aig-run-id": runId } : {} } };
    },
  };
  return { model, getRunId: () => runId, waitForRunId: () => runId ? Promise.resolve(runId) : ready };
}