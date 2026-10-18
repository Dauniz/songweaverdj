import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { ChatCompletion, ChatEventByModel } from "@lovable.dev/ai-gateway";
import { createGatewayModel, gatewayPayload, TEXT_MODEL } from "./gateway-model.server";

const sdk = vi.hoisted(() => ({ generate: vi.fn(), stream: vi.fn() }));
vi.mock("@lovable.dev/ai-gateway", () => ({ generateChatCompletion: sdk.generate, streamChatCompletion: sdk.stream }));
type Event = Exclude<ChatEventByModel[typeof TEXT_MODEL], { error: unknown }>;
function event(delta: Event["choices"][number]["delta"], finish: Event["choices"][number]["finish_reason"] = null): Event {
  return { id: "fixture", model: TEXT_MODEL, object: "chat.completion.chunk", created: 1, choices: [{ index: 0, delta, finish_reason: finish }] };
}
function source(events: Event[]) {
  return { runId: "fixture-run", async *[Symbol.asyncIterator]() { for (const value of events) yield value; } };
}
beforeEach(() => vi.resetAllMocks());
describe("Gateway model compatibility", () => {
  it("uses the approved model and preserves explicit limits and function history", () => {
    const result = gatewayPayload({ maxOutputTokens: 321, prompt: [
      { role: "user", content: [{ type: "text", text: "pick" }] },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c", toolName: "pick_next", input: { code: "T1" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName: "pick_next", output: { type: "json", value: { code: "T1" } } }] },
    ] });
    expect(result.model).toBe("google/gemini-3-flash-preview");
    expect(result.max_tokens).toBe(321);
    expect(result.messages[2]).toEqual({ role: "tool", tool_call_id: "c", content: '{"code":"T1"}' });
  });
  it("keeps JSON response content intact", async () => {
    const response: ChatCompletion = { id: "json", created: 1, model: TEXT_MODEL, object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"confidence":0.8}' } }] };
    sdk.generate.mockResolvedValue(response);
    const result = await createGatewayModel().model.doGenerate({ prompt: [], responseFormat: { type: "json" } });
    expect(result.content).toContainEqual({ type: "text", text: '{"confidence":0.8}' });
    expect(sdk.generate.mock.calls[0]?.[0].response_format).toEqual({ type: "json_object" });
  });
  it("executes a fragmented recommendation tool once and continues the same stream", async () => {
    sdk.stream.mockResolvedValueOnce(source([
      event({ tool_calls: [{ index: 0, id: "pick", function: { name: "recommend_tracks", arguments: '{"code":' } }] }),
      event({ tool_calls: [{ index: 0, function: { arguments: '"T1"}' } }] }, "tool_calls"),
    ])).mockResolvedValueOnce(source([event({ content: "Ready." }, "stop")]));
    const execute = vi.fn(async ({ code }: { code: string }) => ({ code }));
    const result = streamText({ model: createGatewayModel().model, prompt: "Choose from T1", stopWhen: stepCountIs(4), tools: {
      recommend_tracks: tool({ inputSchema: z.object({ code: z.enum(["T1"]) }), execute }),
    } });
    expect(await result.text).toBe("Ready.");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ code: "T1" });
    expect(sdk.stream.mock.calls[1]?.[0].messages.some((m: { role: string }) => m.role === "tool")).toBe(true);
  });
  it("rejects an invalid candidate before executing its tool", async () => {
    sdk.stream.mockResolvedValue(source([event({ tool_calls: [{ index: 0, id: "bad", function: { name: "pick_next", arguments: '{"code":"outside"}' } }] }, "tool_calls")]));
    const execute = vi.fn(async (i) => i);
    const result = streamText({ model: createGatewayModel().model, prompt: "T1 only", stopWhen: stepCountIs(1), tools: { pick_next: tool({ inputSchema: z.object({ code: z.enum(["T1"]) }), execute }) } });
    await result.steps;
    expect(execute).not.toHaveBeenCalled();
  });
  it("reads trailing usage after the finish event", async () => {
    sdk.stream.mockResolvedValue(source([event({ content: "Hi" }, "stop"), { ...event({}), choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }]));
    const result = streamText({ model: createGatewayModel().model, prompt: "Hi" });
    expect(await result.text).toBe("Hi");
    expect((await result.usage).inputTokens).toBe(12);
  });
  it("aborts transport and does not persist a partial reply", async () => {
    const abort = new AbortController();
    sdk.stream.mockImplementation(async (_payload, options) => ({ async *[Symbol.asyncIterator]() {
      yield event({ content: "partial" });
      abort.abort();
      expect(options.signal.aborted).toBe(true);
      throw new DOMException("aborted", "AbortError");
    } }));
    const persist = vi.fn();
    const result = streamText({ model: createGatewayModel().model, prompt: "Hi", abortSignal: abort.signal, onError: () => {} });
    const response = result.toUIMessageStreamResponse({ onFinish: ({ isAborted, responseMessage }) => { if (!isAborted) persist(responseMessage); }, onError: () => "Stopped." });
    await response.text();
    expect(persist).not.toHaveBeenCalled();
  });
  it("preserves Gemini signatures on the next tool step", () => {
    const result = gatewayPayload({ prompt: [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "c", toolName: "pick", input: {}, providerOptions: { lovable: { reasoningDetails: [{ type: "reasoning.encrypted", data: "fixture-signature", format: "google-gemini-v1" }] } } }] }] });
    expect(result.messages[0]).toMatchObject({ reasoning_details: [{ type: "reasoning.encrypted", data: "fixture-signature", format: "google-gemini-v1" }] });
  });
});