import { describe, expect, it } from "vitest";
import { decodeCacheFsPath, encodeCacheFsPath } from "../src/fetch/cache-path.js";

describe("cache-path Windows encoding", () => {
  it("round-trips maud || filenames", () => {
    const rel =
      "corpus/maud/Aegion Corporation_New Mountain Capital, L.L.C..pdf||Aegion Corporation_New Mountain Capital, L.L.C. Amendments No.1 & 2.txt";
    const enc = encodeCacheFsPath(rel);
    expect(enc).not.toMatch(/\|/);
    expect(decodeCacheFsPath(enc)).toBe(rel);
  });

  it("round-trips privacy_qa colon filenames", () => {
    const rel = "corpus/privacy_qa/TickTick: To Do List with Reminder, Day Planner.txt";
    const enc = encodeCacheFsPath(rel);
    expect(enc).not.toMatch(/:/);
    expect(decodeCacheFsPath(enc)).toBe(rel);
  });
});
