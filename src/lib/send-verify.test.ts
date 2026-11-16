import { describe, expect, it } from "vitest";
import { playListBody, recoverStuck, sendVerifyOutcome, stuckRecovery } from "./send-verify";

describe("checked send outcome", () => {
  it("counts the song as playing once Spotify reports it", () => {
    expect(sendVerifyOutcome(true, true)).toBe("playing");
  });
  it("an open app still playing its own song is not 'Spotify closed'", () => {
    expect(sendVerifyOutcome(false, true)).toBe("not_switched");
  });
  it("nothing playing anywhere means Spotify isn't really open", () => {
    expect(sendVerifyOutcome(false, false)).toBe("no_device");
  });
});

describe("recovering when Spotify restarts its own song", () => {
  it("skips forward when Crate's song is already first in next up", () => {
    expect(stuckRecovery("B", "B")).toBe("next");
  });
  it("re-sends when next up holds something else", () => {
    expect(stuckRecovery("X", "B")).toBe("resend");
  });
  it("re-sends when next up can't be read", () => {
    expect(stuckRecovery(null, "B")).toBe("resend");
  });
});

describe("stuck recovery sequence", () => {
  const run = (queues: (string | null)[], checks: boolean[]) => {
    const calls: string[] = [];
    const p = recoverStuck("B", {
      nextUp: async () => { calls.push("queue"); return queues.shift() ?? null; },
      skipForward: async () => { calls.push("next"); return true; },
      resendExplicit: async () => { calls.push("resend"); return true; },
      check: async () => { calls.push("check"); return checks.shift() ?? false; },
    });
    return p.then((ok) => ({ ok, calls }));
  };
  it("song already lined up: one skip, no resend (no extra restart)", async () => {
    expect(await run(["B"], [true])).toEqual({ ok: true, calls: ["queue", "next", "check"] });
  });
  it("not lined up: resend, then skip once it is lined up", async () => {
    expect(await run(["X", "B"], [false, true])).toEqual({ ok: true, calls: ["queue", "resend", "check", "queue", "next", "check"] });
  });
  it("gives up after a skip that didn't help, never skips twice", async () => {
    expect(await run(["B"], [false])).toEqual({ ok: false, calls: ["queue", "next", "check"] });
  });
});

describe("play-list command", () => {
  it("always names the first song, so Spotify doesn't restart its current one", () => {
    expect(playListBody(["spotify:track:B", "spotify:track:C"]).offset).toEqual({ position: 0 });
  });
  it("keeps a resume position when given", () => {
    expect(playListBody(["spotify:track:B"], 42000).position_ms).toBe(42000);
  });
});
