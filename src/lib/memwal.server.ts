import { MemWal } from "@mysten-incubation/memwal";

export type MemoryKind = "taste" | "genre" | "mood_trigger" | "skipped" | "session" | "favorite";

export function memwalConfigured() {
  return Boolean(process.env["MEMWAL_PRIVATE_KEY"] && process.env["MEMWAL_ACCOUNT_ID"]);
}

export function getMemWal(userId: string) {
  const key = process.env["MEMWAL_PRIVATE_KEY"];
  const accountId = process.env["MEMWAL_ACCOUNT_ID"];
  if (!key || !accountId) return null;
  return MemWal.create({
    key,
    accountId,
    serverUrl: process.env["MEMWAL_SERVER_URL"] || "https://relayer.memory.walrus.xyz",
    namespace: `crate-${userId}`,
  });
}

export async function recallMemories(userId: string, query: string, limit = 8) {
  const mw = getMemWal(userId);
  if (!mw) return [] as { text: string; blob_id: string }[];
  try {
    const res = await mw.recall({ query, limit });
    return res.results.map((r) => ({ text: r.text, blob_id: r.blob_id }));
  } catch (e) {
    console.error("[memwal] recall failed", e);
    return [];
  }
}

/** Submit a memory to Walrus; returns the job id (or null when not configured / failed). */
export async function submitMemory(userId: string, kind: MemoryKind, content: string) {
  const mw = getMemWal(userId);
  if (!mw) return { jobId: null as string | null, error: "not_configured" };
  try {
    const accepted = await mw.rememberAsync(`[${kind}] ${content}`);
    return { jobId: accepted.job_id, error: null };
  } catch (e) {
    console.error("[memwal] remember failed", e);
    return { jobId: null, error: e instanceof Error ? e.message : "remember failed" };
  }
}

export async function checkMemoryJob(userId: string, jobId: string) {
  const mw = getMemWal(userId);
  if (!mw) return null;
  try {
    return await mw.getRememberStatus(jobId);
  } catch (e) {
    console.error("[memwal] status failed", e);
    return null;
  }
}
