import { describe, expect, it } from "vitest";
import { dedupePicks } from "./dedupe-picks";

describe("dedupePicks", () => {
  it("drops a repeated Spotify track", () => {
    const r = dedupePicks([
      { spotify_id: "a", name: "One", artists: "X" },
      { spotify_id: "a", name: "One", artists: "X" },
    ]);
    expect(r).toHaveLength(1);
  });
  it("drops the same title and artist under another id", () => {
    const r = dedupePicks([
      { spotify_id: "a", name: "Small Towns", artists: "Band" },
      { spotify_id: "b", name: "small towns ", artists: "band" },
      { spotify_id: "c", name: "Other", artists: "Band" },
    ]);
    expect(r.map((t) => t.spotify_id)).toEqual(["a", "c"]);
  });
  it("drops the playing song", () => {
    const r = dedupePicks([{ spotify_id: "a", name: "One", artists: "X" }, { spotify_id: "b", name: "Two", artists: "X" }], [{ spotify_id: "a" }]);
    expect(r.map((t) => t.spotify_id)).toEqual(["b"]);
  });
});
