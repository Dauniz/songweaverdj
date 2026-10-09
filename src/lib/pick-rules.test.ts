import { describe, expect, it } from "vitest";
import { isFinished, isForgotten, playlistWeight, savedCloseWeight, ERA_CUTOFF, vibeShortlist, newAngleShortlist } from "./pick-rules";

const NOW = Date.UTC(2026, 9, 9);

describe("finished vs skipped", () => {
  it("72% is a skip", () => expect(isFinished(72_000, 100_000)).toBe(false));
  it("95% of a 3-minute song is a skip", () => expect(isFinished(171_000, 180_000)).toBe(false));
  it("reaching the end is finished", () => expect(isFinished(177_000, 180_000)).toBe(true));
});

describe("era scores", () => {
  it("20 songs or fewer is small", () => expect(playlistWeight(20)).toBe(3));
  it("120 songs or fewer is medium", () => expect(playlistWeight(120)).toBe(1.5));
  it("over 120 is huge", () => expect(playlistWeight(121)).toBe(0.5));
  it("saved within 7 days gives 2", () => expect(savedCloseWeight(7)).toBe(2));
  it("saved within 15 days gives 1", () => expect(savedCloseWeight(15)).toBe(1));
  it("16 days gives 0", () => expect(savedCloseWeight(16)).toBe(0));
  it("needs 2.5 to qualify", () => expect(ERA_CUTOFF).toBe(2.5));
});

describe("forgotten favorite", () => {
  const old = new Date(NOW - 300 * 86_400_000).toISOString();
  it("21 streams, none in 6 months", () => expect(isForgotten({ plays: 21, last_played: old }, NOW)).toBe(true));
  it("20 streams is not enough", () => expect(isForgotten({ plays: 20, last_played: old }, NOW)).toBe(false));
  it("4 streams this half-year is not forgotten", () =>
    expect(isForgotten({ plays: 50, last_played: new Date(NOW - 5 * 86_400_000).toISOString(), plays_by_year: { "2026": 4 } }, NOW)).toBe(false));
  it("3 streams this half-year is forgotten", () =>
    expect(isForgotten({ plays: 50, last_played: new Date(NOW - 5 * 86_400_000).toISOString(), plays_by_year: { "2026": 3 } }, NOW)).toBe(true));
});

const mk = (i: number, artists: string, genres: string) => ({ spotify_id: `s${i}`, artists, genres, sources: [{ name: "p" }] });

describe("vibe shortlist", () => {
  it("is 25 songs with at most 5 by the current artist", () => {
    const cur = mk(0, "A", "jazz, soul");
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => mk(i + 1, "A", i < 3 ? "jazz, soul" : "country")),
      ...Array.from({ length: 60 }, (_, i) => mk(i + 100, `B${i}`, i % 2 ? "jazz, soul" : "rock")),
    ];
    const list = vibeShortlist(cur, pool, () => new Set());
    expect(list.length).toBe(25);
    expect(list.filter((s) => s.artists === "A").length).toBe(5);
    expect(list.slice(0, 3).every((s) => s.genres === "jazz, soul")).toBe(true);
  });
});

describe("new angle shortlist", () => {
  it("is 15 songs and the 10 randoms share no genre or artist", () => {
    const session = [mk(0, "A", "jazz")];
    const pool = Array.from({ length: 40 }, (_, i) => mk(i + 1, i < 20 ? "A" : `C${i}`, i < 20 ? "jazz" : "metal"));
    const list = newAngleShortlist(session, pool, NOW);
    expect(list.length).toBe(15);
    expect(list.slice(0, 10).every((s) => s.genres === "metal")).toBe(true);
  });
});
