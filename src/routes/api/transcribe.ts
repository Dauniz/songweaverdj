import { createFileRoute } from "@tanstack/react-router";
import { handleTranscription } from "@/lib/transcription.server";

export const Route = createFileRoute("/api/transcribe")({
  server: { handlers: { POST: ({ request }) => handleTranscription(request) } },
});