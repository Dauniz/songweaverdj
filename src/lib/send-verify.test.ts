import { describe, expect, it } from "vitest";
import { sendVerifyOutcome, stuckRecovery } from "./send-verify";

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
