import { describe, expect, it } from "vitest";
import { pickSongbookTrack, songbookGap } from "./songbook-pool";

const pool = [{ spotify_id: "s1" }, { spotify_id: "s2" }];
const h = (...ids: string[]) => ids.map((spotifyId) => ({ spotifyId }));

describe("songbook pool", () => {
  it("gap is between 4 and 6 songs", () => {
    for (const id of ["a", "bb", "xyz123", ""]) expect([4, 5, 6]).toContain(songbookGap(id));
  });
  it("waits until enough songs have played since the last Songbook song", () => {
    expect(pickSongbookTrack(pool, h("s1", "a", "b", "c"), 4)).toBeNull();
    expect(pickSongbookTrack(pool, h("s1", "a", "b", "c", "d"), 4)?.spotify_id).toBe("s2");
  });
  it("never repeats a song heard recently", () => {
    expect(pickSongbookTrack(pool, h("s1", "s2", "a", "b", "c", "d", "e", "f"), 4)).toBeNull();
  });
  it("respects excluded ids", () => {
    expect(pickSongbookTrack(pool, h("a", "b", "c", "d"), 4, ["s1"])?.spotify_id).toBe("s2");
  });
});

describe("songbook replay", () => {
  it("brings a saved song back after the gap, counting only songs heard since the replay began", () => {
    const pool = [{ spotify_id: "saved1" }];
    const saved = [{ spotifyId: "saved1" }, { spotifyId: "o1" }];
    const sinceReplay = ["n1", "n2", "n3", "n4"].map((spotifyId) => ({ spotifyId }));
    const full = [...saved, ...sinceReplay];
    expect(pickSongbookTrack(pool, full.slice(saved.length), 4)?.spotify_id).toBe("saved1");
    expect(pickSongbookTrack(pool, full.slice(saved.length, saved.length + 3), 4)).toBeNull();
  });
});
