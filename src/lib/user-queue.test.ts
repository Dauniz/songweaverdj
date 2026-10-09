import { describe, expect, it } from "vitest";
import { addToUserQueue, advanceUserQueue, queueDoors } from "./user-queue";

const t = (id: string) => ({ spotify_id: id });

describe("user queue", () => {
  it("drops the head when it starts playing", () => {
    expect(advanceUserQueue([t("b"), t("c")], "b")).toEqual([t("c")]);
  });
  it("keeps the queue while another song plays", () => {
    const q = [t("b"), t("c")];
    expect(advanceUserQueue(q, "a")).toBe(q);
  });
  it("next queued song becomes the door when the head starts", () => {
    const q = advanceUserQueue([t("b"), t("c"), t("d")], "b");
    expect(queueDoors(q)).toEqual({ door: t("c"), after: t("d") });
  });
  it("empty queue hands back to the maze", () => {
    expect(queueDoors(advanceUserQueue([t("b")], "b"))).toEqual({ door: null, after: null });
  });
  it("ignores duplicates and the playing song", () => {
    expect(addToUserQueue([t("b")], t("b"), "a")).toEqual([t("b")]);
    expect(addToUserQueue([t("b")], t("a"), "a")).toEqual([t("b")]);
    expect(addToUserQueue([t("b")], t("c"), "a")).toEqual([t("b"), t("c")]);
  });
});
