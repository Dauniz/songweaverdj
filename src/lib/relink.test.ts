import { describe, expect, it } from "vitest";
import { resolveSentId } from "./relink";

const sent = [{ id: "3WYeza72Tw4pyEZ6T1jEwC", name: "Snooze", artists: "SZA" }];

describe("regional copies of sent songs", () => {
  it("maps Spotify's regional ID back to the song Crate sent", () => {
    expect(resolveSentId({ id: "51fZI04DfYnqHwp5nC6wKA", name: "Snooze", artists: "SZA" }, sent)).toBe("3WYeza72Tw4pyEZ6T1jEwC");
  });
  it("keeps a different song by another artist as foreign", () => {
    expect(resolveSentId({ id: "x", name: "Snooze", artists: "Someone Else" }, sent)).toBe("x");
  });
  it("keeps the exact ID when it already matches", () => {
    expect(resolveSentId({ id: "3WYeza72Tw4pyEZ6T1jEwC", name: "Other", artists: "SZA" }, sent)).toBe("3WYeza72Tw4pyEZ6T1jEwC");
  });
});
