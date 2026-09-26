import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkMemoryJob, memwalConfigured, submitMemory } from "./memwal.server";

export const getMemoryStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ configured: memwalConfigured() }));

export const addMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        kind: z.enum(["taste", "genre", "mood_trigger", "skipped", "session", "favorite"]),
        content: z.string().min(1).max(500),
        origin: z.enum(["chat", "button", "listening"]).default("button"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { jobId, error } = await submitMemory(context.userId, data.kind, data.content);
    const { error: dbErr } = await context.supabase.from("memory_nodes").insert({
      user_id: context.userId,
      kind: data.kind,
      content: data.content,
      origin: data.origin,
      blob_id: jobId ? `job:${jobId}` : null,
      status: jobId ? "pending" : error === "not_configured" ? "local" : "failed",
    });
    if (dbErr) throw new Error(dbErr.message);
    return { ok: true };
  });

/** Wipe everything Crate has learned about this user — keeps the imported library. */
export const resetMemoryLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ confirm: z.literal("RESET") }).parse(d))
  .handler(async ({ context }) => {
    const userId = context.userId;
    const [mem, ev, chat] = await Promise.all([
      context.supabase.from("memory_nodes").delete().eq("user_id", userId),
      context.supabase.from("listening_events").delete().eq("user_id", userId),
      context.supabase.from("chat_messages").delete().eq("user_id", userId),
    ]);
    const err = mem.error ?? ev.error ?? chat.error;
    if (err) throw new Error(err.message);
    return { ok: true };
  });

/** Poll pending Walrus jobs and record their blob ids. */
export const refreshMemories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: pending } = await context.supabase
      .from("memory_nodes")
      .select("id, blob_id")
      .eq("status", "pending")
      .limit(20);
    let updated = 0;
    for (const row of pending ?? []) {
      const jobId = row.blob_id?.startsWith("job:") ? row.blob_id.slice(4) : null;
      if (!jobId) continue;
      const s = await checkMemoryJob(context.userId, jobId);
      if (!s) continue;
      if (s.status === "done" || s.status === "uploaded") {
        await context.supabase
          .from("memory_nodes")
          .update({ status: "stored", blob_id: s.blob_id ?? row.blob_id })
          .eq("id", row.id);
        updated++;
      } else if (s.status === "failed" || s.status === "not_found") {
        await context.supabase.from("memory_nodes").update({ status: "failed" }).eq("id", row.id);
        updated++;
      }
    }
    return { updated };
  });
