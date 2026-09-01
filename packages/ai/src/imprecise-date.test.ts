import { describe, expect, it } from "vitest";
import {
  extractExactDates,
  extractImpreciseWindows,
  filterImpreciseDateContradictionCandidates,
  isImpreciseDateRestatement,
} from "./imprecise-date";

const DEPO =
  "Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.";
const IMPRECISE =
  "I sent the February CAM package around the end of February; I do not remember the exact calendar day.";
const MARCH =
  "Following up — the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.";
const ABOUT = "I sent the package on or about February 28, 2025.";

describe("imprecise-date contradiction reject", () => {
  it("extracts exact month-day-year dates", () => {
    const dates = extractExactDates(DEPO);
    expect(dates).toEqual([{ month: 1, day: 28, year: 2025 }]);
  });

  it("extracts end-of-month windows", () => {
    const windows = extractImpreciseWindows(IMPRECISE);
    expect(windows.some((w) => w.month === 1 && w.kind === "end")).toBe(true);
  });

  it("treats end of February as a restatement of February 28, not a conflict", () => {
    expect(isImpreciseDateRestatement(DEPO, IMPRECISE)).toBe(true);
    expect(isImpreciseDateRestatement(IMPRECISE, DEPO)).toBe(true);
  });

  it("treats on-or-about the same date as a restatement", () => {
    expect(isImpreciseDateRestatement(DEPO, ABOUT)).toBe(true);
  });

  it("treats near the middle of November as compatible with an ISO date in that month", () => {
    expect(
      isImpreciseDateRestatement(
        "The discussion was near the middle of November.",
        "The meeting occurred on 2026-11-10.",
      ),
    ).toBe(true);
    expect(
      isImpreciseDateRestatement(
        "Near the middle of November, at the review meeting.",
        "Minutes dated 2026-11-05.",
      ),
    ).toBe(true);
  });

  it("keeps February 28 vs March 3 as a real date conflict", () => {
    expect(isImpreciseDateRestatement(DEPO, MARCH)).toBe(false);
  });

  it("does not drop a dual-sided candidate whose sides are exact conflicting dates", () => {
    const kept = filterImpreciseDateContradictionCandidates(
      [
        {
          sideA: { chunkIds: ["depo"] },
          sideB: { chunkIds: ["email"] },
        },
      ],
      new Map([
        ["depo", DEPO],
        ["email", MARCH],
      ]),
    );
    expect(kept).toHaveLength(1);
  });

  it("drops a candidate whose sides are February 28 vs end of February", () => {
    const kept = filterImpreciseDateContradictionCandidates(
      [
        {
          sideA: { chunkIds: ["depo"] },
          sideB: { chunkIds: ["imprecise"] },
        },
      ],
      new Map([
        ["depo", DEPO],
        ["imprecise", IMPRECISE],
      ]),
    );
    expect(kept).toHaveLength(0);
  });
});
