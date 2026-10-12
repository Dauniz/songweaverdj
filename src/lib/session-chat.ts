import type { UIMessage } from "ai";
import type { CardTrack } from "@/components/crate/TrackCard";

export type SessionChat = { messages: UIMessage[] };

export function sessionChatKey(userId: string, sessionId: string) {
  return `songweaver-chat:${userId}:${sessionId}`;
}

export function initialPromptPlaylist(messages: UIMessage[]) {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "tool-recommend_tracks" || part.state !== "output-available") continue;
      const output = part.output as {
        steer_only?: boolean;
        vibe_title?: string;
        tracks?: CardTrack[];
      };
      if (!output.steer_only && output.tracks?.length) {
        return {
          title: output.vibe_title || "Crate's playlist",
          tracks: output.tracks.slice(0, 6),
        };
      }
    }
  }
  return null;
}

export function readSessionChat(
  storage: Pick<Storage, "getItem">,
  key: string,
): SessionChat | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionChat;
    return Array.isArray(parsed.messages) ? parsed : null;
  } catch {
    return null;
  }
}
