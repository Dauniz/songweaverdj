import { describe, expect, it } from "vitest";
import { idsToPrune, LOG_KEEP, sessionLength, sessionTitle } from "./session-log";

describe("session log", () => {
  it("keeps only the newest 100 sessions", () => {
    expect(LOG_KEEP).toBe(100);
    const rows = Array.from({ length: 103 }, (_, i) => ({ id: `s${i}` }));
    expect(idsToPrune(rows)).toEqual(["s100", "s101", "s102"]);
    expect(idsToPrune(rows.slice(0, 100))).toEqual([]);
  });

  it("titles a session by its prompt, otherwise by its first song", () => {
    expect(sessionTitle("chill work music", "Song — Artist")).toBe("“chill work music”");
    expect(sessionTitle("  ", "Song — Artist")).toBe("Started from Song — Artist");
  });

  it("shows session length in minutes and hours", () => {
    expect(sessionLength("2026-11-10T10:00:00Z", "2026-11-10T10:42:00Z")).toBe("42 min");
    expect(sessionLength("2026-11-10T10:00:00Z", "2026-11-10T11:10:00Z")).toBe("1 h 10 min");
  });
});
