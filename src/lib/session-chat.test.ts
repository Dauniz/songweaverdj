import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { initialPromptPlaylist, readSessionChat, sessionChatKey } from "./session-chat";

describe("session chat", () => {
  const messages = [
    { id: "prompt", role: "user", parts: [{ type: "text", text: "Quiet morning" }] },
  ] satisfies UIMessage[];
  it("restores the same conversation for the resumed session", () => {
    const key = sessionChatKey("account-a", "session-a");
    const storage = new Map([[key, JSON.stringify({ messages })]]);
    expect(readSessionChat({ getItem: (k) => storage.get(k) ?? null }, key)?.messages).toEqual(
      messages,
    );
  });
  it("a fresh session has no previous chat", () => {
    const storage = new Map([[sessionChatKey("account-a", "old"), JSON.stringify({ messages })]]);
    expect(
      readSessionChat(
        { getItem: (k) => storage.get(k) ?? null },
        sessionChatKey("account-a", "new"),
      ),
    ).toBeNull();
  });
  it("isolates conversations by account", () => {
    expect(sessionChatKey("account-a", "same")).not.toBe(sessionChatKey("account-b", "same"));
  });
  it("retains the initial six picks rather than later steering picks", () => {
    const tracks = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      name: `Song ${i}`,
      artists: "Artist",
    }));
    const history = [
      {
        id: "initial",
        role: "assistant",
        parts: [
          {
            type: "tool-recommend_tracks",
            state: "output-available",
            toolCallId: "initial",
            input: {},
            output: { vibe_title: "Morning", tracks },
          },
        ],
      },
      {
        id: "steer",
        role: "assistant",
        parts: [
          {
            type: "tool-recommend_tracks",
            state: "output-available",
            toolCallId: "steer",
            input: {},
            output: { steer_only: true, tracks: [] },
          },
        ],
      },
    ] as UIMessage[];
    expect(initialPromptPlaylist(history)).toEqual({ title: "Morning", tracks });
  });
});
