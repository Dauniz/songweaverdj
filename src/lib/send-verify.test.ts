import { describe, expect, it } from "vitest";
import { sendVerifyOutcome } from "./send-verify";

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
