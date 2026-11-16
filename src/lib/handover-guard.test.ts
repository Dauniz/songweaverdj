import { describe, expect, it } from "vitest";
import { safeSeekMs, staleFinishAction } from "./handover-guard";

describe("finished song still reported after the hand-over", () => {
  it("waits during the first 4 seconds", () => {
    expect(staleFinishAction(3_999, false)).toBe("wait");
  });
  it("re-sends the finish pair once after 4 seconds", () => {
    expect(staleFinishAction(4_000, false)).toBe("resend");
  });
  it("keeps waiting up to 10 seconds after the re-send", () => {
    expect(staleFinishAction(9_999, true)).toBe("wait");
  });
  it("lets go 10 seconds after the re-send", () => {
    expect(staleFinishAction(10_000, true)).toBe("release");
  });
});

describe("send position", () => {
  it("never aims at the last 3 seconds of a song", () => {
    expect(safeSeekMs(211_900, 211_736)).toBe(208_736);
  });
  it("keeps a normal mid-song position", () => {
    expect(safeSeekMs(60_000, 211_736)).toBe(60_000);
  });
  it("keeps the position when the length is unknown", () => {
    expect(safeSeekMs(211_900, 0)).toBe(211_900);
  });
});
