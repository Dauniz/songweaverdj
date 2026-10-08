import { describe, expect, it } from "vitest";
import { computeCooldowns, type CooldownEvent } from "./cooldowns";

let t = 0;
const ev = (session: string, event: string, name = "Song", artists = "Band"): CooldownEvent => ({
  track_name: name, artists, event, session_id: session, created_at: new Date(1_700_000_000_000 + ++t * 1000).toISOString(),
});
const sessions = (n: number) => Array.from({ length: n }, (_, i) => ev(`s${i}`, "play_through", `filler${i}`, "x"));

describe("skip cooldowns", () => {
  it("2 early skips within 3 sessions rests the song for 2 sessions", () => {
    const e = [...sessions(1), ev("s0", "early_skip"), ev("s0", "early_skip")];
    expect(computeCooldowns(e).songs).toEqual([{ name: "Song", artists: "Band", sessionsLeft: 2 }]);
  });
  it("one skip never rests a song", () => {
    expect(computeCooldowns([...sessions(1), ev("s0", "early_skip")]).songs).toEqual([]);
  });
  it("the cooldown ends after 2 more sessions", () => {
    t = 0;
    const e = [ev("a", "early_skip"), ev("a", "early_skip"), ev("b", "play_through", "o", "x"), ev("c", "play_through", "o", "x")];
    expect(computeCooldowns(e).songs).toEqual([]);
  });
  it("playing it through lifts the cooldown", () => {
    const e = [ev("a", "early_skip"), ev("a", "early_skip"), ev("a", "play_through")];
    expect(computeCooldowns(e).songs).toEqual([]);
  });
  it("Don't suggest rests a song for 3 sessions", () => {
    expect(computeCooldowns([ev("a", "explicit_skip")]).songs[0]?.sessionsLeft).toBe(3);
  });
  it("3 skips of one artist in a session rests the artist for 2 sessions", () => {
    const e = [ev("a", "early_skip", "1"), ev("a", "early_skip", "2"), ev("a", "early_skip", "3")];
    expect(computeCooldowns(e).artists).toEqual([{ artists: "Band", sessionsLeft: 2 }]);
  });
});
