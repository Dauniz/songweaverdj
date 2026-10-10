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
  const cur = mk(0, "A", "jazz, soul");
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => mk(i + 1, "A", i < 3 ? "jazz, soul" : "country")),
    ...Array.from({ length: 60 }, (_, i) => mk(i + 100, `B${i % 15}`, i % 2 ? "jazz, soul" : "rock")),
  ];
  it("is 25 songs with at most 2 by the current artist", () => {
    const list = vibeShortlist(cur, pool, () => new Set());
    expect(list.length).toBe(25);
    expect(list.filter((s) => s.artists === "A").length).toBe(2);
  });
  it("has none by the current artist if heard in the last 3 songs", () => {
    const list = vibeShortlist(cur, pool, () => new Set(), { recentArtists: ["A"] });
    expect(list.filter((s) => s.artists === "A").length).toBe(0);
  });
  it("keeps at most 1 song per album", () => {
    const albumPool = Array.from({ length: 40 }, (_, i) => ({ ...mk(i + 1, `C${i % 20}`, "jazz, soul"), album: "Same" }));
    const list = vibeShortlist(cur, albumPool, () => new Set());
    const keys = list.map((s) => `${s.artists}|${s.album}`);
    expect(new Set(keys.slice(0, 20)).size).toBe(Math.min(20, keys.slice(0, 20).length));
  });
});

describe("vibe variety", () => {
  it("rejects an artist from the last 3 songs", () =>
    expect(violatesVariety({ artists: "A" }, [{ artists: "A" }, { artists: "B" }, { artists: "C" }])).toBe(true));
  it("allows an artist heard 4 songs ago", () =>
    expect(violatesVariety({ artists: "A" }, [{ artists: "A" }, { artists: "B" }, { artists: "C" }, { artists: "D" }])).toBe(false));
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

import { defaultSuggestionMix, isAllTimeFavorite, isCurrentFavorite } from "./pick-rules";
describe("studio suggestions default mix", () => {
  const song = (id: string, plays: number, extra: Partial<{ last_played: string; plays_by_year: Record<string, number> }> = {}) => ({
    spotify_id: id, name: `Song ${id}`, artists: `Artist ${id}`, plays, ...extra,
  });
  it("more than 67 streams is an all-time favorite", () => {
    expect(isAllTimeFavorite({ plays: 68 })).toBe(true);
    expect(isAllTimeFavorite({ plays: 67 })).toBe(false);
  });
  it("more than 5 streams in 4 weeks is a current favorite", () => {
    expect(isCurrentFavorite(6)).toBe(true);
    expect(isCurrentFavorite(5)).toBe(false);
  });
  const favs = Array.from({ length: 20 }, (_, i) => song(`f${i}`, 100 + i, { last_played: "2026-10-01", plays_by_year: { "2026": 50 } }));
  const curr = Array.from({ length: 5 }, (_, i) => song(`c${i}`, 8));
  const forgot = Array.from({ length: 5 }, (_, i) => song(`g${i}`, 30, { last_played: "2023-01-01", plays_by_year: { "2023": 30 } }));
  const wild = Array.from({ length: 10 }, (_, i) => song(`w${i}`, 1));
  const recent = new Map(curr.map((c) => [c.spotify_id, 6]));
  const pool = [...favs, ...curr, ...forgot, ...wild];
  it("picks 2/2/2/2 with no repeats", () => {
    const mix = defaultSuggestionMix(pool, recent, NOW);
    expect(mix).toHaveLength(8);
    expect(new Set(mix.map((m) => m.spotify_id)).size).toBe(8);
    expect(mix.slice(0, 2).every((m) => m.spotify_id.startsWith("f"))).toBe(true);
    expect(mix.slice(2, 4).every((m) => m.spotify_id.startsWith("c"))).toBe(true);
    expect(mix.slice(4, 6).every((m) => m.spotify_id.startsWith("g"))).toBe(true);
  });
  it("favorites are random, not just the top streamed", () => {
    const firsts = new Set(Array.from({ length: 30 }, () => defaultSuggestionMix(pool, recent, NOW)[0]!.spotify_id));
    expect(firsts.size).toBeGreaterThan(3);
  });
  it("a short group rolls into the next", () => {
    const mix = defaultSuggestionMix([...favs, ...forgot, ...wild], new Map(), NOW, () => 0.5);
    expect(mix).toHaveLength(8);
    expect(mix.filter((m) => m.spotify_id.startsWith("g")).length).toBe(4);
  });
});
