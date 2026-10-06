import { describe, expect, it } from "vitest";
import { DEEPENING_ASSIGNMENTS } from "../datasets/deepening/catalog";
import { runDeepeningPass } from "../runner/deepening";

describe("full-completion deepening assignments", () => {
  it("keeps distinct deepening scenarios and does not reuse Week 5 ids", () => {
    expect(DEEPENING_ASSIGNMENTS).toHaveLength(19);
    expect(new Set(DEEPENING_ASSIGNMENTS.map((row) => row.id)).size).toBe(19);
    expect(DEEPENING_ASSIGNMENTS.filter((row) => row.id.startsWith("D3-"))).toHaveLength(7);
    expect(DEEPENING_ASSIGNMENTS.every((row) => !row.id.startsWith("W5-"))).toBe(true);
    expect(DEEPENING_ASSIGNMENTS.every((row) => row.rubric.length > 0 && row.expected.length > 0)).toBe(true);
  });

  it("passes the deterministic deepening set", () => {
    const result = runDeepeningPass();
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(DEEPENING_ASSIGNMENTS.length);
    expect(result.grades.every((grade) => grade.passed)).toBe(true);
  });
});
