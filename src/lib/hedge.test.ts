import { describe, expect, it } from "vitest";
import { hedged } from "./hedge";

const after = <T,>(ms: number, v: T, signal?: AbortSignal) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => res(v), ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); });
  });

describe("hedged AI pick", () => {
  it("a fast answer wins without starting a backup", async () => {
    let calls = 0;
    const v = await hedged((s) => { calls++; return after(20, "fast", s); }, { hedgeMs: 100, deadlineMs: 500 });
    expect(v).toBe("fast");
    expect(calls).toBe(1);
  });

  it("a slow first answer is beaten by the backup started at the hedge time", async () => {
    let calls = 0;
    const t0 = Date.now();
    const v = await hedged((s) => (++calls === 1 ? after(2_000, "slow", s) : after(30, "backup", s)), { hedgeMs: 80, deadlineMs: 1_000 });
    expect(v).toBe("backup");
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it("gives up at the deadline so code can pick instead", async () => {
    const t0 = Date.now();
    const v = await hedged((s) => after(5_000, "never", s), { hedgeMs: 50, deadlineMs: 200 });
    expect(v).toBeNull();
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it("an empty first answer starts the backup at once", async () => {
    let calls = 0;
    const v = await hedged((s) => (++calls === 1 ? after(10, null, s) : after(10, "second", s)), { hedgeMs: 5_000, deadlineMs: 6_000 });
    expect(v).toBe("second");
  });
});
