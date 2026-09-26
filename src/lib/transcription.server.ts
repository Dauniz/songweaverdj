import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const MODEL = "google/gemini-3.5-transcribe";
const MAX_FILE_BYTES = 14 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 128 * 1024;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function isAuthenticated(request: Request) {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || token.split(".").length !== 3) return false;
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.auth.getClaims(token);
  return !error && Boolean(data?.claims?.sub);
}

export async function handleTranscription(request: Request) {
  if (!(await isAuthenticated(request))) return json(401, { error: "Please sign in again." });
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return json(500, { error: "Voice transcription is not configured." });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_REQUEST_BYTES) return json(413, { error: "That recording is too large." });

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return json(400, { error: "The recording could not be read." });
  }
  const file = incoming.get("file");
  if (!(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES || !file.type.startsWith("audio/")) {
    return json(400, { error: "Please record a short voice prompt and try again." });
  }

  const form = new FormData();
  form.append("model", MODEL);
  form.append("file", file, file.name || "voice-prompt.wav");
  form.append("response_format", "json");
  form.append("stream", "true");
  const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: form,
    signal: request.signal,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      ...(upstream.headers.get("X-Lovable-AIG-Run-ID")
        ? { "X-Lovable-AIG-Run-ID": upstream.headers.get("X-Lovable-AIG-Run-ID") ?? "" }
        : {}),
    },
  });
}